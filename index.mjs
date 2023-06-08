import {AWSWebApplicationFirewall} from "./modules/aws.mjs";
import pkg from "@azure/functions";

const {app, HttpResponse} = pkg;
const response = (status, body) => new HttpResponse({
    status: status,
    headers: {'Content-Type': 'application/json'},
    body: typeof body === "object" ? JSON.stringify(body) : body
});

app.http('HttpTrigger', {
    route: 'voucher',
    authLevel: 'function',
    methods: ['GET'],
    handler: async (request, context) => {
        let result;
        const awsWAF = new AWSWebApplicationFirewall("https://my.freenom.com/clientarea.php");
        // Get inputs
        let inputs;
        context.log("Getting inputs...");
        [result, inputs] = await awsWAF.getInputs();
        if (!result) return response(500, inputs);
        // Verify browser
        let browser;
        context.log("Verifying browser...");
        [result, browser] = await awsWAF.verifyBrowser(inputs);
        if (!result) return response(500, browser);
        // Get captcha problem
        let problem;
        context.log("Getting captcha problem...");
        [result, problem] = await awsWAF.getProblem("audio");
        if (!result) return response(500, problem);
        // Solve captcha problem
        let verify;
        for (let _ = 0; _ < 5; _++) {
            let solution;
            context.log("Solving captcha...");
            [result, solution] = await awsWAF.solveProblem(problem);
            if (!result) return response(500, solution);
            // Verify solution
            context.log("Verifying solution...");
            [result, verify] = await awsWAF.verifySolution(problem, solution);
            if (!result) return response(500, verify);
            if (!verify.success) {
                context.warn("Captcha verification failed, retrying...");
                problem = verify.problem;
            } else break;
        }
        // Redeem voucher
        let voucher;
        context.log("Redeeming voucher...");
        [result, voucher] = await awsWAF.redeemVoucher(verify.captcha_voucher, browser.token);
        if (!result) return response(500, voucher);

        return response(200, {
            status: true,
            token: voucher.token
        });
    }
});
