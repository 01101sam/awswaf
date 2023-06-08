import fetch from "node-fetch";

export const secondsToString = second => {
    const numberEnding = number => (number > 1) ? 's' : '';
    let temp = Math.floor(second);
    const years = Math.floor(temp / 31536000);
    if (years) return years + ' year' + numberEnding(years);
    // TODO: Months! Maybe weeks?
    const days = Math.floor((temp %= 31536000) / 86400);
    if (days) return days + ' day' + numberEnding(days);
    const hours = Math.floor((temp %= 86400) / 3600);
    if (hours) return hours + ' hour' + numberEnding(hours);
    const minutes = Math.floor((temp %= 3600) / 60);
    if (minutes) return minutes + ' minute' + numberEnding(minutes);
    const seconds = temp % 60;
    if (seconds) return seconds + ' second' + numberEnding(seconds);
    return 'Just now';
}

export const error = (code, msg, stack = null, session = null) => [false, {error: msg, code, stack, session}];

export const randInt = (min, max) => Math.random() * (max - min) + min;

export const choice = array => array[Math.floor(Math.random() * array.length)];

export const all = (...array) => array.every(i => Boolean(i));

export const any = (...array) => array.some(i => Boolean(i));

export class Automation {
    constructor() {
        this.host = "https://api.0s.hk:8443";
        this.version = "v1";
    }

    /**
     * Get Domain Email Verification Code
     *
     * @param {string} email - Email Address
     * @returns {Promise<[Boolean, String | Object]>}
     */
    async getDomainEmailCode(email) {
        const perfKey = `Email-${email}`;
        let res, counter = 0;
        performance.mark(perfKey);
        while (1) {
            try {
                if (performance.measure("", perfKey).duration / 1000 >= 200) break;
                res = await fetch(`${this.host}/${this.version}/email_code_aws`, {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({add: email})
                });
                if (res.status !== 200) {
                    counter++;
                    if (counter >= 3) return error("GET_EMAIL_OTP_TIMEOUT", "Timeout when getting email code");
                    continue;
                } else if (res.status >= 500) {
                    console.log(`Server error when getting email code (${res.status}), retrying...`);
                    continue;
                }
                console.debug(`Get Email Code (${email}): ${Math.floor(performance.measure("", perfKey).duration / 1000)}s`);
                performance.clearMarks(perfKey);
                performance.clearMarks("");
                return [true, (await res.json())['data']['code']];
            } catch (e) {
                return error("GET_EMAIL_OTP_ERROR", "Error occurred when getting email code", e.stack);
            }
        }
        performance.clearMarks(perfKey);
        performance.clearMarks("");
        return error("GET_EMAIL_OTP_FAILED", "Failed to get email code");
    }

    /**
     * Get Outlook Email Verification Code
     *
     * @param {string} email - Email Address
     * @param {string} password - Password
     * @returns {Promise<[Boolean, String | Object]>}
     */
    async getOutlookEmailCode(email, password) {
        const perfKey = `Email-${email}`;
        let res, counter = 0;
        performance.mark(perfKey);
        while (1) {
            try {
                if (performance.measure("", perfKey).duration / 1000 >= 200) break;
                res = await fetch(`${this.host}/${this.version}/outlook_aws`, {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({email, password})
                });
                if (res.status !== 200) {
                    counter++;
                    if (counter >= 3) return error("GET_EMAIL_OTP_TIMEOUT", "Timeout when getting email code");
                    continue;
                } else if (res.status >= 500) {
                    console.log(`Server error when getting email code (${res.status}), retrying...`);
                    continue;
                }
                console.debug(`Get Email Code (${email}): ${Math.floor(performance.measure("", perfKey).duration / 1000)}s`);
                performance.clearMarks(perfKey);
                performance.clearMarks("");
                const respJSON = await res.json();
                if (respJSON.error) return error("GET_EMAIL_OTP_ERROR", respJSON.error, respJSON);
                return [true, respJSON['data']['code']];
            } catch (e) {
                return error("GET_EMAIL_OTP_ERROR", "Error occurred when getting email code", e.stack);
            }
        }
        performance.clearMarks(perfKey);
        performance.clearMarks("");
        return error("GET_EMAIL_OTP_FAILED", "Failed to get email code");
    }
}