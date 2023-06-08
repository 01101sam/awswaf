import crc32 from "crc32";
import canvas from 'canvas';
import fetch from 'node-fetch';
import ffmpeg from "fluent-ffmpeg";
import {choice, error, randInt} from "./utils.mjs";
import {genUA} from "./userAgent.mjs";
import {v4 as UUIDv4} from 'uuid';
import crypto from "crypto";
import {Readable} from "stream";
import scrypt from "../hash_challenge/scrypt.mjs";
import verifyHash from "../hash_challenge/verify.mjs";


/**
 * AWS Captcha Bypass using Azure STT.
 *
 * @param host {String} - AWS Endpoint Hostname
 * @param userAgent {String} - User Agent
 * @param cookieJar - Cookie Jar of Register Session
 */
class AWSVoiceCaptcha {
    constructor() {
        // Audio
        this.rawAudioData = null;

        // Azure
        const azureRegion = "eastasia";
        this.azureSubKey = "962d1864108f4e6bb4a0b473d2f22dda";
        this.azureSTTEndpoint = `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`;
        // FIXME: This is only for production.
        ffmpeg.setFfmpegPath("./modules/bin/ffmpeg");
    }

    /**
     * Get processed AWS Captcha Audio
     *
     * @return {Promise<[Boolean, stream.Writable | Object]>} - Audio stream.
     * @private
     */
    async _getAudio() {
        let resp, respJSON;
        try {
            resp = await fetch("https://awswafstt.azurewebsites.net/process?" + new URLSearchParams({
                code: "gwrSteVdcs7mRdYWBJx5KEel98LFZZGSOTvuCRJcD7hvAzFuuaSsAg=="
            }), {
                method: "POST",
                headers: {
                    "Content-Type": "audio/x-flac",
                    Accept: "application/json"
                },
                body: ffmpeg(this.rawAudioData).format("flac").pipe()
            });
            respJSON = resp.headers.get("Content-Type") === "application/json" ? await resp.json() : null;
            if (!resp) return error("AWS_STT_REQUEST_FAILED", "Failed to request to AWS STT");
            if (!resp.ok)
                return error("AWS_STT_PROCESS_FAILED", `Failed to process raw audio data (HTTP Status: ${resp.status})`, respJSON);
        } catch (e) {
            return error("AWS_STT_REQUEST_ERROR", "Error occurred when requesting to AWS STT", e.stack);
        }
        try {
            return [true, await resp.arrayBuffer()];
        } catch (e) {
            return error("AUDIO_ENCODE_FAILED", "Audio encode failed", e.stack);
        }
    }

    /**
     * Get AWS Captcha Audio answer.
     *
     * @param {stream.Writable} audioBin - Audio stream
     * @return {Promise<[Boolean, String | Object]>} - Captcha answer
     * @private
     */
    async _getAudioAnswer(audioBin) {
        const query = "language=en-US&format=detailed&profanity=raw";
        let resp;
        try {
            resp = await fetch(`${this.azureSTTEndpoint}?${query}`, {
                method: "POST",
                headers: {
                    "Ocp-Apim-Subscription-Key": this.azureSubKey,
                    "Content-Type": "audio/wave",
                    "Accept": "application/json"
                },
                body: audioBin
            });
        } catch (e) {
            return error("AZ_STT_REQ_FAILED", `Failed to request to Azure STT`, e.stack);
        }
        if (resp.status !== 200) return error("INVALID_HTTP_STATUS", `Invalid HTTP status code when requesting Azure STT (HTTP Status: ${resp.status})`);
        const json = await resp.json();
        if (json['NBest'][0]['Confidence'] <= 0.69) console.debug("[Azure STT] Warning: Low Confidence");
        return [true, json['NBest'][0]['ITN'].split(" ").slice(-2, -1)[0]];
    }

    /**
     * Set raw audio data
     *
     * @param {String} audioData - Raw audio data, base64 encoded
     */
    setAudioData(audioData) {
        this.rawAudioData = Readable.from(Buffer.from(audioData, "base64"));
    }

    /**
     * Get AWS Captcha Audio with guesses.
     *
     * @return {Promise<[Boolean, Object]>} - Captcha answer
     */
    async getCaptchaResponse() {
        if (!this.rawAudioData) return error("AUDIO_DATA_NOT_SET", "Raw audio data not set");
        let result, audioBin, audioGuess;
        [result, audioBin] = await this._getAudio();
        if (!result) return error("AUDIO_PROCESS_FAILED", "AWS Captcha audio process failed", audioBin);
        try {
            [result, audioGuess] = await this._getAudioAnswer(audioBin);
            if (!result) {
                console.debug(`Failed to get AWS Captcha audio answer: ${audioGuess['msg']}${audioGuess.error ? `\nStack: ${audioGuess.stack}` : ""}`);
            }
        } catch (e) {
            return error("AUDIO_ANSWER_FAILED", "AWS Captcha audio guess failed", e.stack);
        }
        return [true, audioGuess];
    }
}

/**
 * AWS Fingerprint generator
 */
class AWSFingerPrint {
    constructor(userAgent = genUA()) {
        this.resolution = choice(["3840-2160-2140", "1536-864-824", "5120-2880-2860", "2560-1440-1420"]);
        this.userAgent = userAgent;
        this.location = "";
        this.referer = "";
    }

    setLocation(url) {
        this.location = url;
    }

    setReferer(url = "") {
        this.referer = url;
    }

    _provide() {
        return {
            identifier: "KramerAndRio", material: [1311738035, 312286030, 2043623273, 3937688527]
        };
    }

    _encrypt({checksum, content}) {
        const provider = this._provide();  // material is unused
        const aesKey = Buffer.from("93d9f6846b629edb2bdc4466af627d998496cb0c08f9cf043de68d6b25aa9693", "hex"),
            iv = Buffer.from(crypto.randomBytes(12));
        // AES-GCM
        const encryptedResult = this._doEncrypt(content, aesKey, iv);
        return `${checksum}#` + [
            provider.identifier,
            Buffer.from(iv).toString('base64'),
            encryptedResult.tag.toString('hex'),
            encryptedResult.encrypted
        ].join("::");
    }

    _encode(collectData) {
        const strJson = JSON.stringify(collectData), checksum = crc32(strJson).toUpperCase();
        return {checksum, content: `${checksum}#${strJson}`};
    }

    _doEncrypt(content, aesKey, ivValue) {
        const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, ivValue);
        let encrypted = cipher.update(content, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return {encrypted, tag: cipher.getAuthTag()}
    }

    _fakeCanvas() {
        const
            tmpArr = [],
            constant = -1e+300,
            fillTextContent = "Cwm fjordbank glyphs vext quiz,",
            c = canvas.createCanvas(150, 60),
            ctx = c.getContext("2d");
        ctx.rect(0, 0, 10, 10);
        ctx.rect(2, 2, 6, 6);
        tmpArr.push(!ctx.isPointInPath(5, 5, 'evenodd') ? 'yes' : 'no');
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "#f60";
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = "#069";
        ctx.font = "8pt Arial";
        ctx.fillText(fillTextContent, 2, 15);
        ctx.fillStyle = "rgba(102, 204, 0, 0.2)";
        ctx.font = "11pt Arial";
        ctx.fillText(fillTextContent, 4, 45);
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = "rgb(255,0,255)";
        ctx.beginPath();
        ctx.arc(20, 20, 20, 0, 2 * Math.PI, true);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgb(0,255,255)";
        ctx.beginPath();
        ctx.arc(50, 20, 20, 0, 2 * Math.PI, true);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgb(255,255,0)";
        ctx.beginPath();
        ctx.arc(35, 40, 20, 0, 2 * Math.PI, true);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgb(255,0,255)";
        ctx.arc(20, 25, 10, 0, 2 * Math.PI, true);
        ctx.arc(20, 25, 20, 0, 2 * Math.PI, true);
        ctx.fill("evenodd");
        const linearGradient = ctx.createLinearGradient(40, 50, 60, 78);
        linearGradient.addColorStop(0, "blue");
        linearGradient.addColorStop(0.5, "red");
        linearGradient.addColorStop(1, "white");
        ctx.fillStyle = linearGradient;
        ctx.beginPath();
        ctx.arc(70, 50, 10, 0, 2 * Math.PI, true);
        ctx.closePath();
        ctx.fill();
        ctx.font = "10pt Sans";
        ctx.strokeText(Math.tan(constant).toString(), 4, 30);
        ctx.fillText(Math.cos(constant).toString(), 4, 40);
        ctx.fillText(Math.sin(constant).toString(), 4, 50);
        ctx.beginPath();
        ctx.moveTo(25, 0);
        ctx.quadraticCurveTo(1, 1, 1, 5);
        ctx.quadraticCurveTo(1, 76, 26, 10);
        ctx.quadraticCurveTo(26, 96, 6, 12);
        ctx.quadraticCurveTo(60, 96, 41, 10);
        ctx.quadraticCurveTo(121, 86, 101, 7);
        ctx.quadraticCurveTo(121, 1, 56, 1);
        ctx.stroke();
        ctx.globalCompositeOperation = "difference";
        ctx.fillStyle = "rgb(255,0,255)";
        ctx.beginPath();
        ctx.arc(80, 20, 20, 0, 2 * Math.PI, true);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgb(0,255,255)";
        ctx.beginPath();
        ctx.arc(110, 20, 20, 0, 2 * Math.PI, true);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgb(255,255,0)";
        ctx.beginPath();
        ctx.arc(95, 40, 20, 0, 2 * Math.PI, true);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgb(255,0,255)";
        tmpArr.push(`canvas fp:${c.toDataURL()}`);
        let emailHash = null;
        // SKIP for now
        // ...
        // ctx.fillStyle = "#808080";
        // ctx.font = "8pt Arial";
        // ctx.fillText(email, 2, 30);
        // emailHash = CRC32.str(c.toDataURL());
        const imgData = ctx.getImageData(0, 0, 150, 60).data, histogramBins = Array(256).fill(0);
        for (let i = 0; i < imgData; i++) histogramBins[imgData[i]]++;
        return {
            canvas: {
                hash: crc32.direct(tmpArr.join("~")),
                emailHash, histogramBins
            }
        }
    }

    _generateFingerprintValues() {
        const
            startTime = new Date().getTime(),
            endTime = startTime + parseInt(Math.random().toString().substring(2, 6));
        return {
            metrics: {
                "fp2": 0,
                "browser": 0,
                "capabilities": 0,
                "gpu": 0,
                "dnt": 0,
                "math": 0,
                "screen": 0,
                "navigator": 0,
                "auto": 0,
                "subtle": 0,
                "canvas": 0
            },
            start: startTime,
            automation: {
                wd: {
                    properties: {
                        document: [],
                        window: [],
                        navigator: []
                    }
                },
                phantom: {
                    properties: {
                        window: []
                    }
                }
            },
            end: endTime,
            flashVersion: null,
            crypto: {
                "crypto": 1,
                "subtle": 1,
                "encrypt": true,
                "decrypt": true,
                "wrapKey": true,
                "unwrapKey": true,
                "sign": true,
                "verify": true,
                "digest": true,
                "deriveBits": true,
                "deriveKey": true,
                "getRandomValues": true,
                "randomUUID": true
            },
            id: UUIDv4(),
            plugins: `PDF Viewer Chrome PDF Viewer Chromium PDF Viewer Microsoft Edge PDF Viewer WebKit built-in PDF ||${this.resolution}-24-*-*-*`,
            dupedPlugins: `PDF Viewer Chrome PDF Viewer Chromium PDF Viewer Microsoft Edge PDF Viewer WebKit built-in PDF ||${this.resolution}-24-*-*-*`,
            screenInfo: `${this.resolution}-24-*-*-*`,
            referrer: this.referer,
            userAgent: this.userAgent,
            location: this.location,
            webDriver: false,
            capabilities: {
                css: {
                    textShadow: 1,
                    WebkitTextStroke: 1,
                    boxShadow: 1,
                    borderRadius: 1,
                    borderImage: 1,
                    opacity: 1,
                    transform: 1,
                    transition: 1
                },
                js: {
                    audio: true,
                    geolocation: true,
                    localStorage: "supported",
                    touch: false,
                    video: true,
                    webWorker: true
                },
                elapsed: 0
            },
            gpu: null,
            dnt: 1,
            math: {
                tan: "-1.4214488238747245",
                sin: "0.8178819121159085",
                cos: "-0.5753861119575491"
            },
            canvas: this._fakeCanvas(),
            errors: [],
            version: "2.2.0"
        }
    }

    /**
     * Generate a fake fingerprint
     *
     * @returns {String} Fingerprint
     * @public
     */
    generateFingerprint() {
        return this._encrypt(this._encode(this._generateFingerprintValues()));
    }
}

export class AWSWebApplicationFirewall {
    constructor(url) {
        // Endpoint
        const parsedUrl = new URL(url);
        this.host = `https://${parsedUrl.host}`;
        this.targetUrl = url;
        this.domain = parsedUrl.host;
        this.tokenEndpoint = "https://f6f157a0c4af.5e4b41f9.eu-west-1.token.awswaf.com/f6f157a0c4af/2a5119942dc9/59075d3bccee";
        this.captchaEndpoint = this.tokenEndpoint.replace("token", "captcha");

        // Network
        this.userAgent = genUA();

        // Anti-bot / Automation
        this.fingerprint = new AWSFingerPrint(this.userAgent);
        this.stt = new AWSVoiceCaptcha();

        this.fingerprint.setLocation(url);

        // Cache
        this.token = null;
    }

    /**
     * Generate headers
     *
     * @param body {Object} - Request body
     * @param form {boolean} - Whether the body is a form
     * @returns Object
     * @private
     */
    _getHeaderInit(body = null, form = false) {
        return {
            method: body ? "POST" : "GET",
            headers: {
                "User-Agent": this.userAgent,
                "Content-Type": body ? `application/${form ? "x-www-form-urlencoded" : "json"}` : undefined,
                "Origin": this.host
            },
            body: body ? form ? (new URLSearchParams(body)).toString() : JSON.stringify(body) : undefined
        }
    }

    async getWebpage() {
        const regex = /"key"(?<space>:\s+)?:\k<space>?"(?<key>.+)",\n\s+"iv"\k<space>?:\k<space>?"(?<iv>.+)",\n\s+"context"\k<space>?:\k<space>?"(?<context>.+)"/g;
        let resp;
        try {
            resp = await fetch("https://freenom-auto-renew.fucknom.workers.dev/", this._getHeaderInit());
            if (resp.status !== 405) return error("INVALID_HTTP_STATUS", `Invalid response when getting webpage (HTTP Status: ${resp.status})`);
            const html = await resp.text();
            const matches = regex.exec(html);
            if (!matches) return error("INVALID_RESPONSE", "Invalid response when getting webpage (No matches)");
            const {key, iv, context} = matches.groups;
            return [true, {key, iv, context}];
        } catch (e) {
            return error("GET_WEBPAGE_ERROR", "Error occurred when getting webpage", e.stack);
        }
    }

    async getInputs() {
        let resp, respJSON;
        try {
            resp = await fetch(`${this.tokenEndpoint}/inputs?client=browser`, this._getHeaderInit());
            respJSON = (resp.headers.get("Content-Type") || []).includes("application/json") ? await resp.json() : null;
            if (resp.status !== 200) return error("INVALID_HTTP_STATUS", `Invalid response when getting inputs (HTTP Status: ${resp.status})`, respJSON);
            else if (![
                "h72f957df656e80ba55f5d8ce2e8c7ccb59687dba3bfb273d54b08a261b2f3002",
                "h7b0c470f0cfe3a80a9e26526ad185f484f6817d0832712a4a37a908786a6a67f"
            ].includes(respJSON['challenge_type']))
                return error("INVALID_CHALLENGE_TYPE", `Invalid challenge type when getting inputs (Challenge Type: ${respJSON['challenge_type'] || null})`, respJSON);
            return [true, respJSON];
        } catch (e) {
            return error("GET_INPUTS_ERROR", "Error occurred when getting inputs", e.stack);
        }
    }

    async solveChallenge(challenge, fingerprint) {
        // Goal: Get target hmac by looping through all possible inputs (Like mining bitcoin, just brute forcing hashes)
        const checksum = fingerprint.split("#")[0],
            initInput = challenge.challenge.input + checksum,
            memory = 128;
        let tryCount = 0;
        let hashFuncName;
        while (1) {
            const data = initInput + tryCount;
            let hash;
            switch (challenge.challenge_type) {
                case "h72f957df656e80ba55f5d8ce2e8c7ccb59687dba3bfb273d54b08a261b2f3002":  // Scrypt Hash Calculate (HashcashScrypt)
                    hashFuncName = "HashcashScrypt";
                    try {
                        hash = await scrypt(data, checksum, {
                            N: memory,
                            r: 8,
                            p: 1,
                            dkLen: 16,
                            encoding: "hex"
                        });
                    } catch (e) {
                        console.error(e);
                        throw new Error(`Scrypt error: ${e.stack}`);
                    }
                    break;
                case "h7b0c470f0cfe3a80a9e26526ad185f484f6817d0832712a4a37a908786a6a67f":  // SHA256 Hash Calculate (HashcashSHA2)
                    hashFuncName = "HashcashSHA2";
                    try {
                        const sha256Hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)),
                            hashes = [], hashDV = new DataView(sha256Hash);
                        for (let i = 0; i < hashDV.byteLength; i += 4) {
                            const rawHash = hashDV.getUint32(i).toString(16),
                                prefix = "0".repeat(8);
                            hashes.push((prefix + rawHash).slice(-prefix.length));
                        }
                        hash = hashes.join("");
                    } catch (e) {
                        throw new Error(`SHA256 error: ${e.stack}`);
                    }
                    break;
                default:
                    throw new Error("Unsupported challenge");
            }
            if (verifyHash(challenge.difficulty, hash)) {
                console.debug(`Solved challenge: ${hashFuncName} (${tryCount} tries)`);
                return tryCount.toString();
            }
            tryCount++;
        }
    }

    async verifyBrowser(challenge) {
        let resp, respJSON;
        try {
            console.debug("Generating fingerprint...");
            const fingerprint = this.fingerprint.generateFingerprint(),
                [checksum, leftOver] = fingerprint.split("#"),
                provider = leftOver.split("::")[0],
                present = leftOver.split("::").slice(1).join("::");
            console.debug("Solving challenge...");
            const solution = await this.solveChallenge(challenge, fingerprint);
            console.debug("Sending verification request...");
            resp = await fetch(`${this.tokenEndpoint}/verify`, this._getHeaderInit({
                challenge: challenge.challenge,
                checksum,
                client: "Browser",
                domain: this.domain,
                existing_token: this.token,
                metrics: [],
                signals: [{
                    name: provider,
                    value: {Present: present}
                }],
                solution
            }));
            respJSON = (resp.headers.get("Content-Type") || []).includes("application/json") ? await resp.json() : null;
            if (resp.status !== 200) return error("INVALID_HTTP_STATUS", `Invalid response when verifying browser (HTTP Status: ${resp.status})`, respJSON);
            else if (!respJSON.token) return error("INVALID_RESPONSE", "Invalid response when verifying browser (No token was provided)", respJSON);
            else if (respJSON.inputs) {
                console.debug(`WAF requested another verification, retrying...`);
                return await this.verifyBrowser(respJSON.inputs);
            }
            this.token = respJSON.token;
            return [true, respJSON];
        } catch (e) {
            console.error(e);
            return error("BROWSER_VERIFY_ERROR", "Error occurred when verifying browser", e.stack);
        }
    }

    /**
     * Get captcha problem
     *
     * @param kind - visual or audio
     * @return {Promise<[boolean,{stack: null, code: *, session: null, error: *}]|(boolean|*)[]>}
     */
    async getProblem(kind) {
        let resp, respJSON;
        try {
            resp = await fetch(`${this.captchaEndpoint}/problem?kind=${kind}&domain=${this.domain}&locale=en-us`, this._getHeaderInit());
            respJSON = (resp.headers.get("Content-Type") || []).includes("application/json") ? await resp.json() : null;
            if (resp.status !== 200) return error("INVALID_HTTP_STATUS", `Invalid response when getting problem (HTTP Status: ${resp.status})`, respJSON);
            return [true, respJSON];
        } catch (e) {
            return error("GET_PROBLEM_ERROR", "Error occurred when getting problem", e.stack);
        }
    }

    async solveProblem(problem) {
        let result, data;
        // Too much time-wasting on visual, let's skip
        switch (problem['problem_type']) {
            // case "toycarcity":  // Visual
            // Point the car destination
            // {x: ?, y: ?}
            // case "bifurcatedzoo":  // Slider
            // case "bifurcatedproducts":  // Same
            // "number"
            /*
                Targets:
                - cube
                - cone
                - pyramid
                - knot (绳结)
                - ball
                - donut
                - cylinder
             */
            case "noisyneighbour":  // Voice
                // Type one of two following words spoken by me
                this.stt.setAudioData(problem['assets'].audio);
                [result, data] = await this.stt.getCaptchaResponse();
                if (!result) return error("STT_ERROR", "Error occurred when getting captcha response", data);
                return [true, data];
            default:
                return error("UNSUPPORTED_PROBLEM", `Unsupported problem type: ${problem['problem_type']}`);
        }
    }

    async verifySolution(challenge, solution) {
        let result, goKuProps;
        [result, goKuProps] = await this.getWebpage();
        if (!result) return error("INVALID_INIT_ARGS", "Invalid initial properties when getting webpage", goKuProps);
        let resp, respJSON;
        try {
            resp = await fetch(`${this.captchaEndpoint}/verify`, this._getHeaderInit({
                client_solution: solution,
                goku_props: goKuProps,
                hmac_tag: challenge.hmac_tag,
                key: challenge.key,
                locale: "en-us",
                metrics: {solve_time_millis: randInt(1500, 5000)},
                state: challenge.state
            }));
            respJSON = (resp.headers.get("Content-Type") || []).includes("application/json") ? await resp.json() : null;
            if (resp.status !== 200) return error("INVALID_HTTP_STATUS", `Invalid response when verifying solution (HTTP Status: ${resp.status})`, respJSON);
            return [true, respJSON];
        } catch (e) {
            return error("VERIFY_SOLUTION_ERROR", "Error occurred when verifying solution", e.stack);
        }
    }

    async redeemVoucher(captchaToken, existingToken) {
        let resp, respJSON;
        try {
            resp = await fetch(`${this.tokenEndpoint}/voucher`, this._getHeaderInit({
                captcha_voucher: captchaToken,
                existing_token: existingToken
            }));
            respJSON = (resp.headers.get("Content-Type") || []).includes("application/json") ? await resp.json() : null;
            if (resp.status !== 200) return error("INVALID_HTTP_STATUS", `Invalid response when redeeming voucher (HTTP Status: ${resp.status})`, respJSON);
            else if (!respJSON.token) return error("INVALID_RESPONSE", "Invalid response when redeeming voucher (No token was provided)", respJSON);
            // Cookie key: aws-waf-token
            return [true, respJSON];
        } catch (e) {
            return error("REDEEM_VOUCHER_ERROR", "Error occurred when redeeming voucher", e.stack);
        }
    }
}
