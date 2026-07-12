// transport/ws.js — WebSocket transport (extracted from original lines 1087-1558)
import { toBytes, dataLength, concatBytes, sha224str, log, closeSocketQuietly, wsSend } from "../utils.js";
import { WS_EARLY_DATA_MAX_BYTES, WS_EARLY_DATA_MAX_HEADER_LEN, UPSTREAM_QUEUE_MAX_BYTES, UPSTREAM_QUEUE_MAX_ITEMS } from "../context.js";
import { createUpstreamQueue } from "../stream/upstream-queue.js";
import { parseTrojan } from "../protocol/trojan.js";
import { parseVLESS } from "../protocol/vless.js";
import { forwardataTCP, forwardataudp, isSpeedTestSite } from "../proxy/forward.js";
import { forwardTrojanUDP } from "../protocol/trojan.js";
import { SS_CIPHER_CONFIGS, SS_TAG_LEN, SS_NONCE_LEN, deriveMasterKey, deriveSessionKey, ssEncrypt, ssDecrypt } from "../protocol/shadowsocks.js";

// ---- UUID helpers (inline) ----
const UUID_BYTES_CACHE = new Map();
function hexNibble(code) { if (code >= 48 && code <= 57) return code - 48; code |= 32; if (code >= 97 && code <= 102) return code - 87; return -1; }
function getUUIDBytes(uuid) { const key = String(uuid || ""); let c = UUID_BYTES_CACHE.get(key); if (c) return c; const clean = key.replace(/-/g, ""); if (clean.length !== 32) return null; const bytes = new Uint8Array(16); for (let i = 0; i < 16; i++) { const h = hexNibble(clean.charCodeAt(i * 2)); const l = hexNibble(clean.charCodeAt(i * 2 + 1)); if (h < 0 || l < 0) return null; bytes[i] = (h << 4) | l; } if (UUID_BYTES_CACHE.size >= 32) UUID_BYTES_CACHE.clear(); UUID_BYTES_CACHE.set(key, bytes); return bytes; }
function uuidBytesMatch(data, offset, uuid) { const exp = getUUIDBytes(uuid); if (!exp || data.byteLength < offset + 16) return false; for (let i = 0; i < 16; i++) if (data[offset + i] !== exp[i]) return false; return true; }

// ---- Early data validation/decoding (original lines 1087-1126) ----
function isValidWSEarlyData(bytes, token) {
	if (!bytes?.byteLength) return false;
	if (bytes.byteLength >= 18 && uuidBytesMatch(bytes, 1, token)) return true;
	if (bytes.byteLength < 58 || bytes[56] !== 0x0d || bytes[57] !== 0x0a) return false;

	const trojanPassword = sha224str(token);
	for (let i = 0; i < 56; i++) {
		if (bytes[i] !== trojanPassword.charCodeAt(i)) return false;
	}
	return true;
}

function decodeWSEarlyData(header, token) {
	if (!header) return null;
	if (header.length > WS_EARLY_DATA_MAX_HEADER_LEN) throw new Error('early data is too large');

	let bytes;
	const Uint8ArrayBase64 = /** @type {any} */ (Uint8Array);
	if (typeof Uint8ArrayBase64.fromBase64 === 'function') {
		try {
			bytes = Uint8ArrayBase64.fromBase64(header, { alphabet: 'base64url' });
		} catch (_) { }
	}
	if (!bytes) {
		let normalized = header.replace(/-/g, '+').replace(/_/g, '/');
		const padding = normalized.length % 4;
		if (padding) normalized += '='.repeat(4 - padding);
		let binaryString;
		try {
			binaryString = atob(normalized);
		} catch (_) {
			return null;
		}
		bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
	}

	if (bytes.byteLength > WS_EARLY_DATA_MAX_BYTES) throw new Error('early data is too large');
	return isValidWSEarlyData(bytes, token) ? bytes : null;
}

export { decodeWSEarlyData };

// ---- Main handler (original lines 1129-1558) ----
export async function handleWS(request, yourUUID, url) {
	const wsPair = new WebSocketPair();
	const [clientSock, serverSock] = Object.values(wsPair);
	try { (/** @type {any} */ (serverSock)).accept({ allowHalfOpen: true }) }
	catch (_) { serverSock.accept() }
	serverSock.binaryType = 'arraybuffer';
	let remoteConnWrapper = { socket: null, connectingPromise: null, retryConnect: null };
	let isDnsQuery = false;
	let isTrojan = null;
	const trojanUDPCtx = { cache: new Uint8Array(0) };
	const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
	const ssDisableEarlyData = !!url.searchParams.get('enc');
	let wsUpstreamQueue = null;
	let wsExplicitChain = Promise.resolve();
	let wsExplicitStopRecv = false, wsExplicitFailed = false, wsExplicitDrainQueued = false;
	let wsExplicitQueueBytes = 0, wsExplicitQueueItems = 0;
	let protocolType = null, currentWriteSocket = null, remoteWriter = null;
	let ssCtx = null, ssInitTask = null;

	const releaseRemoteWriter = () => {
		if (remoteWriter) {
			try { remoteWriter.releaseLock() } catch (e) { }
			remoteWriter = null;
		}
		currentWriteSocket = null;
	};

	const upstreamQueue = wsUpstreamQueue = createUpstreamQueue({
		getWriter: () => {
			const socket = remoteConnWrapper.socket;
			if (!socket) return null;
			if (socket !== currentWriteSocket) {
				releaseRemoteWriter();
				currentWriteSocket = socket;
				remoteWriter = socket.writable.getWriter();
			}
			return remoteWriter;
		},
		releaseWriter: releaseRemoteWriter,
		retryConnect: async () => {
			if (typeof remoteConnWrapper.retryConnect !== 'function') throw new Error('retry unavailable');
			await remoteConnWrapper.retryConnect();
		},
		closeConnection: () => {
			try { remoteConnWrapper.socket?.close() } catch (e) { }
			closeSocketQuietly(serverSock);
		},
		name: 'WS upstream'
	});

	const writeToRemote = async (chunk, allowRetry = true) => {
		return upstreamQueue.writeAndWait(chunk, allowRetry);
	};

	const getSSCtx = async () => {
		if (ssCtx) return ssCtx;
		if (!ssInitTask) {
			ssInitTask = (async () => {
				const requestCipher = (url.searchParams.get('enc') || '').toLowerCase();
				const preferredCipher = SS_CIPHER_CONFIGS[requestCipher] || SS_CIPHER_CONFIGS['aes-128-gcm'];
				const candidateCiphers = [preferredCipher, ...Object.values(SS_CIPHER_CONFIGS).filter(c => c.method !== preferredCipher.method)];
				const inboundMasterKeyCache = new Map();
				const getInboundMasterKeyTask = (config) => {
					if (!inboundMasterKeyCache.has(config.method)) inboundMasterKeyCache.set(config.method, deriveMasterKey(yourUUID, config.keyLen));
					return inboundMasterKeyCache.get(config.method);
				};
				const inboundState = {
					buffer: new Uint8Array(0),
					hasSalt: false,
					waitPayloadLength: null,
					decryptKey: null,
					nonceCounter: new Uint8Array(SS_NONCE_LEN),
					cipherConfig: null,
				};
				const initInboundDecryptState = async () => {
					const lengthCipherTotalLength = 2 + SS_TAG_LEN;
					const maxSaltLen = Math.max(...candidateCiphers.map(c => c.saltLen));
					const maxAlignScanBytes = 16;
					const maxScanOffset = Math.min(maxAlignScanBytes, Math.max(0, inboundState.buffer.byteLength - (lengthCipherTotalLength + Math.min(...candidateCiphers.map(c => c.saltLen)))));
					for (let offset = 0; offset <= maxScanOffset; offset++) {
						for (const cipherConfig of candidateCiphers) {
							const initMinLen = offset + cipherConfig.saltLen + lengthCipherTotalLength;
							if (inboundState.buffer.byteLength < initMinLen) continue;
							const salt = inboundState.buffer.subarray(offset, offset + cipherConfig.saltLen);
							const lengthCipher = inboundState.buffer.subarray(offset + cipherConfig.saltLen, initMinLen);
							const masterKey = await getInboundMasterKeyTask(cipherConfig);
							const decryptKey = await deriveSessionKey(cipherConfig, masterKey, salt, ['decrypt']);
							const nonceCounter = new Uint8Array(SS_NONCE_LEN);
							try {
								const lengthPlain = await ssDecrypt(decryptKey, nonceCounter, lengthCipher);
								if (lengthPlain.byteLength !== 2) continue;
								const payloadLength = (lengthPlain[0] << 8) | lengthPlain[1];
								if (payloadLength < 0 || payloadLength > cipherConfig.maxChunk) continue;
								if (offset > 0) log(`[SS inbound] detected leading noise ${offset}B, auto-aligned`);
								if (cipherConfig.method !== preferredCipher.method) log(`[SS inbound] URL enc=${requestCipher || preferredCipher.method} mismatched actual ${cipherConfig.method}, auto-switched`);
								inboundState.buffer = inboundState.buffer.subarray(initMinLen);
								inboundState.decryptKey = decryptKey;
								inboundState.nonceCounter = nonceCounter;
								inboundState.waitPayloadLength = payloadLength;
								inboundState.cipherConfig = cipherConfig;
								inboundState.hasSalt = true;
								return true;
							} catch (_) { }
						}
					}
					const initFailThreshold = maxSaltLen + lengthCipherTotalLength + maxAlignScanBytes;
					if (inboundState.buffer.byteLength >= initFailThreshold) {
						throw new Error(`SS handshake decrypt failed (enc=${requestCipher || 'auto'}, candidates=${candidateCiphers.map(c => c.method).join('/')})`);
					}
					return false;
				};
				const inboundDecrypter = {
					async input(dataChunk) {
						const chunk = toBytes(dataChunk);
						if (chunk.byteLength > 0) inboundState.buffer = concatBytes(inboundState.buffer, chunk);
						if (!inboundState.hasSalt) {
							const initOk = await initInboundDecryptState();
							if (!initOk) return [];
						}
						const plaintextChunks = [];
						while (true) {
							if (inboundState.waitPayloadLength === null) {
								const lengthCipherTotalLength = 2 + SS_TAG_LEN;
								if (inboundState.buffer.byteLength < lengthCipherTotalLength) break;
								const lengthCipher = inboundState.buffer.subarray(0, lengthCipherTotalLength);
								inboundState.buffer = inboundState.buffer.subarray(lengthCipherTotalLength);
								const lengthPlain = await ssDecrypt(inboundState.decryptKey, inboundState.nonceCounter, lengthCipher);
								if (lengthPlain.byteLength !== 2) throw new Error('SS length decrypt failed');
								const payloadLength = (lengthPlain[0] << 8) | lengthPlain[1];
								if (payloadLength < 0 || payloadLength > inboundState.cipherConfig.maxChunk) throw new Error(`SS payload length invalid: ${payloadLength}`);
								inboundState.waitPayloadLength = payloadLength;
							}
							const payloadCipherTotalLength = inboundState.waitPayloadLength + SS_TAG_LEN;
							if (inboundState.buffer.byteLength < payloadCipherTotalLength) break;
							const payloadCipher = inboundState.buffer.subarray(0, payloadCipherTotalLength);
							inboundState.buffer = inboundState.buffer.subarray(payloadCipherTotalLength);
							const payloadPlain = await ssDecrypt(inboundState.decryptKey, inboundState.nonceCounter, payloadCipher);
							plaintextChunks.push(payloadPlain);
							inboundState.waitPayloadLength = null;
						}
						return plaintextChunks;
					},
				};
				let outboundEncrypter = null;
				const ssBatchMaxBytes = 32 * 1024;
				const getOutboundEncrypter = async () => {
					if (outboundEncrypter) return outboundEncrypter;
					if (!inboundState.cipherConfig) throw new Error('SS cipher is not negotiated');
					const outboundCipher = inboundState.cipherConfig;
					const outboundMasterKey = await deriveMasterKey(yourUUID, outboundCipher.keyLen);
					const outboundSalt = crypto.getRandomValues(new Uint8Array(outboundCipher.saltLen));
					const outboundEncryptKey = await deriveSessionKey(outboundCipher, outboundMasterKey, outboundSalt, ['encrypt']);
					const outboundNonceCounter = new Uint8Array(SS_NONCE_LEN);
					let saltSent = false;
					outboundEncrypter = {
						async encryptAndSend(dataChunk, sendChunk) {
							const plaintextData = toBytes(dataChunk);
							if (!saltSent) {
								await sendChunk(outboundSalt);
								saltSent = true;
							}
							if (plaintextData.byteLength === 0) return;
							let offset = 0;
							while (offset < plaintextData.byteLength) {
								const end = Math.min(offset + outboundCipher.maxChunk, plaintextData.byteLength);
								const payloadPlain = plaintextData.subarray(offset, end);
								const lengthPlain = new Uint8Array(2);
								lengthPlain[0] = (payloadPlain.byteLength >>> 8) & 0xff;
								lengthPlain[1] = payloadPlain.byteLength & 0xff;
								const lengthCipher = await ssEncrypt(outboundEncryptKey, outboundNonceCounter, lengthPlain);
								const payloadCipher = await ssEncrypt(outboundEncryptKey, outboundNonceCounter, payloadPlain);
								const frame = new Uint8Array(lengthCipher.byteLength + payloadCipher.byteLength);
								frame.set(lengthCipher, 0);
								frame.set(payloadCipher, lengthCipher.byteLength);
								await sendChunk(frame);
								offset = end;
							}
						},
					};
					return outboundEncrypter;
				};
				let ssSendQueue = Promise.resolve();
				const ssEnqueueSend = (chunk) => {
					ssSendQueue = ssSendQueue.then(async () => {
						if (serverSock.readyState !== WebSocket.OPEN) return;
						const enc = await getOutboundEncrypter();
						await enc.encryptAndSend(chunk, async (encryptedChunk) => {
							if (encryptedChunk.byteLength > 0 && serverSock.readyState === WebSocket.OPEN) {
								await wsSend(serverSock, encryptedChunk.buffer);
							}
						});
					}).catch((error) => {
						log(`[SS send] encrypt failed: ${error?.message || error}`);
						closeSocketQuietly(serverSock);
					});
					return ssSendQueue;
				};
				const replySocket = {
					get readyState() {
						return serverSock.readyState;
					},
					send(data) {
						const chunk = toBytes(data);
						if (chunk.byteLength <= ssBatchMaxBytes) {
							return ssEnqueueSend(chunk);
						}
						for (let i = 0; i < chunk.byteLength; i += ssBatchMaxBytes) {
							ssEnqueueSend(chunk.subarray(i, Math.min(i + ssBatchMaxBytes, chunk.byteLength)));
						}
						return ssSendQueue;
					},
					close() {
						closeSocketQuietly(serverSock);
					}
				};
				ssCtx = {
					inboundDecrypter,
					replySocket,
					firstPacketEstablished: false,
					targetHost: '',
					targetPort: 0,
				};
				return ssCtx;
			})().finally(() => { ssInitTask = null });
		}
		return ssInitTask;
	};

	const processSSData = async (chunk) => {
		const ctx = await getSSCtx();
		let plainChunks = null;
		try {
			plainChunks = await ctx.inboundDecrypter.input(chunk);
		} catch (err) {
			const msg = err?.message || `${err}`;
			if (msg.includes('Decryption failed') || msg.includes('SS handshake decrypt failed') || msg.includes('SS length decrypt failed')) {
				log(`[SS inbound] decrypt failed, closing: ${msg}`);
				closeSocketQuietly(serverSock);
				return;
			}
			throw err;
		}
		for (const plainChunk of plainChunks) {
			let written = false;
			try {
				written = await writeToRemote(plainChunk, false);
			} catch (err) {
				if ((/** @type {any} */ (err))?.isQueueOverflow) throw err;
				written = false;
			}
			if (written) continue;
			if (ctx.firstPacketEstablished && ctx.targetHost && ctx.targetPort > 0) {
				await forwardataTCP(ctx.targetHost, ctx.targetPort, plainChunk, ctx.replySocket, null, remoteConnWrapper, yourUUID, request);
				continue;
			}
			const plainData = toBytes(plainChunk);
			if (plainData.byteLength < 3) throw new Error('invalid ss data');
			const addressType = plainData[0];
			let cursor = 1;
			let hostname = '';
			if (addressType === 1) {
				if (plainData.byteLength < cursor + 4 + 2) throw new Error('invalid ss ipv4 length');
				hostname = `${plainData[cursor]}.${plainData[cursor + 1]}.${plainData[cursor + 2]}.${plainData[cursor + 3]}`;
				cursor += 4;
			} else if (addressType === 3) {
				if (plainData.byteLength < cursor + 1) throw new Error('invalid ss domain length');
				const domainLength = plainData[cursor];
				cursor += 1;
				if (plainData.byteLength < cursor + domainLength + 2) throw new Error('invalid ss domain data');
				hostname = new TextDecoder().decode(plainData.subarray(cursor, cursor + domainLength));
				cursor += domainLength;
			} else if (addressType === 4) {
				if (plainData.byteLength < cursor + 16 + 2) throw new Error('invalid ss ipv6 length');
				const ipv6 = [];
				const ipv6View = new DataView(plainData.buffer, plainData.byteOffset + cursor, 16);
				for (let i = 0; i < 8; i++) ipv6.push(ipv6View.getUint16(i * 2).toString(16));
				hostname = ipv6.join(':');
				cursor += 16;
			} else {
				throw new Error(`invalid ss addressType: ${addressType}`);
			}
			if (!hostname) throw new Error(`invalid ss address: ${addressType}`);
			const port = (plainData[cursor] << 8) | plainData[cursor + 1];
			cursor += 2;
			const rawClientData = plainData.subarray(cursor);
			if (isSpeedTestSite(hostname)) throw new Error('Speedtest site is blocked');
			ctx.firstPacketEstablished = true;
			ctx.targetHost = hostname;
			ctx.targetPort = port;
			await forwardataTCP(hostname, port, rawClientData, ctx.replySocket, null, remoteConnWrapper, yourUUID, request);
		}
	};

	const processWSInbound = async (chunk) => {
		let currentChunkBytes = null;
		if (isDnsQuery) {
			if (isTrojan) return await forwardTrojanUDP(chunk, serverSock, trojanUDPCtx, request);
			return await forwardataudp(chunk, serverSock, null, request);
		}
		if (protocolType === 'ss') {
			await processSSData(chunk);
			return;
		}
		if (await writeToRemote(chunk)) return;

		if (protocolType === null) {
			if (url.searchParams.get('enc')) protocolType = 'ss';
			else {
				currentChunkBytes = currentChunkBytes || toBytes(chunk);
				const bytes = currentChunkBytes;
				protocolType = bytes.byteLength >= 58 && bytes[56] === 0x0d && bytes[57] === 0x0a ? 'trojan' : 'vless';
			}
			isTrojan = protocolType === 'trojan';
			log(`[WS forward] protocol: ${protocolType} | from: ${url.host} | UA: ${request.headers.get('user-agent') || 'unknown'}`);
		}

		if (protocolType === 'ss') {
			await processSSData(chunk);
			return;
		}
		if (await writeToRemote(chunk)) return;
		if (protocolType === 'trojan') {
			const parsed = parseTrojan(chunk, yourUUID);
			if (parsed?.hasError) throw new Error(parsed.message || 'Invalid trojan request');
			const { port, hostname, rawClientData, isUDP } = parsed;
			if (isSpeedTestSite(hostname)) throw new Error('Speedtest site is blocked');
			if (isUDP) {
				isDnsQuery = true;
				if (dataLength(rawClientData) > 0) return forwardTrojanUDP(rawClientData, serverSock, trojanUDPCtx, request);
				return;
			}
			await forwardataTCP(hostname, port, rawClientData, serverSock, null, remoteConnWrapper, yourUUID, request);
		} else {
			isTrojan = false;
			currentChunkBytes = currentChunkBytes || toBytes(chunk);
			const bytes = currentChunkBytes;
			const parsed = parseVLESS(bytes, yourUUID);
			if (parsed?.hasError) throw new Error(parsed.message || 'Invalid vless request');
			const { port, hostname, version, isUDP, rawClientData } = parsed;
			if (isSpeedTestSite(hostname)) throw new Error('Speedtest site is blocked');
			if (isUDP) {
				if (port === 53) isDnsQuery = true;
				else throw new Error('UDP is not supported');
			}
			const respHeader = new Uint8Array([version, 0]);
			const rawData = rawClientData;
			if (isDnsQuery) {
				if (isTrojan) return forwardTrojanUDP(rawData, serverSock, trojanUDPCtx, request);
				return forwardataudp(rawData, serverSock, respHeader, request);
			}
			await forwardataTCP(hostname, port, rawData, serverSock, respHeader, remoteConnWrapper, yourUUID, request);
		}
	};

	const handleWSExplicitError = (err) => {
		if (wsExplicitFailed) return;
		wsExplicitFailed = true;
		wsExplicitStopRecv = true;
		wsExplicitQueueBytes = 0;
		wsExplicitQueueItems = 0;
		const msg = err?.message || `${err}`;
		if (msg.includes('Network connection lost') || msg.includes('ReadableStream is closed')) {
			log(`[WS forward] connection ended: ${msg}`);
		} else {
			log(`[WS forward] processing failed: ${msg}`);
		}
		upstreamQueue.clear();
		releaseRemoteWriter();
		closeSocketQuietly(serverSock);
	};

	const appendWSExplicitTask = (task) => {
		wsExplicitChain = wsExplicitChain.then(task).catch(handleWSExplicitError);
		return wsExplicitChain;
	};

	const enqueueWSExplicit = (data) => {
		if (wsExplicitStopRecv || wsExplicitFailed) return;
		const chunkSize = Math.max(0, dataLength(data));
		const nextBytes = wsExplicitQueueBytes + chunkSize;
		const nextItems = wsExplicitQueueItems + 1;
		if (nextBytes > UPSTREAM_QUEUE_MAX_BYTES || nextItems > UPSTREAM_QUEUE_MAX_ITEMS) {
			handleWSExplicitError(new Error(`[WS explicit] queue overflow: ${nextBytes}B/${nextItems}`));
			return;
		}
		wsExplicitQueueBytes = nextBytes;
		wsExplicitQueueItems = nextItems;
		appendWSExplicitTask(async () => {
			wsExplicitQueueBytes = Math.max(0, wsExplicitQueueBytes - chunkSize);
			wsExplicitQueueItems = Math.max(0, wsExplicitQueueItems - 1);
			if (wsExplicitFailed) return;
			await processWSInbound(data);
		});
	};

	const drainWSExplicit = () => {
		if (wsExplicitDrainQueued) return;
		wsExplicitDrainQueued = true;
		wsExplicitStopRecv = true;
		appendWSExplicitTask(async () => {
			if (wsExplicitFailed) return;
			await upstreamQueue.waitEmpty();
			releaseRemoteWriter();
		});
	};

	serverSock.addEventListener('message', (event) => {
		enqueueWSExplicit(event.data);
	});
	serverSock.addEventListener('close', () => {
		closeSocketQuietly(serverSock);
		drainWSExplicit();
	});
	serverSock.addEventListener('error', (err) => {
		handleWSExplicitError(err);
	});

	// SS mode disables sec-websocket-protocol early-data to avoid injecting subprotocol value (e.g. "binary")
	// as base64 data into the first packet, which would cause AEAD decrypt failure.
	if (!ssDisableEarlyData && earlyDataHeader) {
		try {
			const bytes = decodeWSEarlyData(earlyDataHeader, yourUUID);
			if (bytes?.byteLength) enqueueWSExplicit(bytes.buffer);
		} catch (error) {
			handleWSExplicitError(error);
		}
	}

	return new Response(null, { status: 101, webSocket: clientSock, headers: { 'Sec-WebSocket-Extensions': '' } });
}