import {chromium} from "playwright";
import fs from "fs";
import {JSDOM} from "jsdom";

const rootUrl = "https://my.freenom.com/clientarea.php";


(async () => {
    const browser = await chromium.launch({
        headless: false,
        devtools: true,
        args: ["--start-maximized"]
    });
    const context = await browser.newContext({viewport: null, locale: "en-US"});
    const page = await context.newPage();

    // Intercept all network requests
    await page.route("**/*", async (route) => {
        // Replace the response with a local file if the URL matches
        const targetUrl = route.request().url(),
            urlObj = new URL(targetUrl),
            urlParts = urlObj.pathname.split("/"),
            targetPage = urlParts.pop();
        if (["clientarea.php", "captcha.js", "challenge.js"].includes(targetPage) && route.request().method() === "GET") {
            targetPage.endsWith("php") && await context.clearCookies();
            console.debug(`Intercepted request for captcha: ${targetPage}`);
            const response = await route.fetch(), headers = response.headers();
            headers["Content-type"] = targetPage.endsWith("js") ? 'application/javascript' : 'text/html';
            headers["Content-type"] += "; charset=utf-8";
            delete headers["Content-Security-Policy"];
            delete headers["Content-Length"];
            let body;
            if (targetPage === "clientarea.php") {
                body = await response.text();
                const dom = new JSDOM(body);
                // Change the title
                dom.window.document.title = "Inside AWS WAF";
                // Loop over all script tags
                for (const script of dom.window.document.querySelectorAll("script")) {
                    if (script.src && script.src.endsWith(".js")) {
                        // Replace the script path to a local file (map local)
                        script.src = script.src.split("/").pop();
                    }
                }
                // Replace the body with the modified HTML
                body = dom.serialize();
            } else body = fs.readFileSync(targetPage, "utf8");
            await route.fulfill({
                status: 200,
                response,
                headers,
                body
            });
        } else if (targetPage === "voucher") {
            console.info("CAPTCHA passed");
            await page.pause();
            await route.continue();
        } else if ([
                "inputs",
                "problem",
                "verify"
            ].includes(targetPage) &&
            urlObj.host === "my.freenom.com") {
            let postData;
            // Change host to https://f6f157a0c4af.5e4b41f9.eu-west-1.captcha.awswaf.com before requesting
            urlObj.host = "f6f157a0c4af.5e4b41f9.eu-west-1.captcha.awswaf.com";
            urlObj.pathname = `/f6f157a0c4af/2a5119942dc9/59075d3bccee/${targetPage}`;
            const response = await route.fetch({url: urlObj.toString(), postData}),
                headers = response.headers();
            delete headers["Content-Security-Policy"];
            if (response.status() === 400) debugger;
            await route.fulfill({headers, response});
        } else {
            await route.continue();
        }
    });

    page.on("close", () => {
        console.log("page closed");
        browser.close();
        process.exit(0);
    });
    await page.goto(rootUrl, {timeout: 0});
})();
