import { connect, launch } from 'puppeteer';
import { randomBytes } from 'crypto';
import showMouseJs from './showMouse.js';
class BrowserBot {

    launchNewBrowser;
    debug = 0;
    disconnectCount = 0
    profileName
    browser
    page

    logger
    rules = []// [{partialUrl, elementPath, action, matcherType}]
    reqResCallbacks = {}
    globalReqResCallbacks = {}
    keepSingleTabInBrowser = true
    defaultUrl
    showMouse = false
    browserURL

    static PERIODIC_INTERVAL = 5000
    constructor(launchNewBrowser, profileName, defaultUrl, browserURL) {
        this.launchNewBrowser = launchNewBrowser
        this.profileName = profileName
        this.defaultUrl = defaultUrl
        this.browserURL = browserURL
    }

    log(...params) {
        if (this.logger)
            this.logger(params)
        if (this.debug)
            console.log(params.join(" "))
    }

    clearAllRules() {
        this.rules = []
    }

    clearAllCallbacks(skipRules,) {
        this.globalReqResCallbacks = []
        this.reqResCallbacks = []
    }

    async closeCurrentPage(page, safe) {
        try {
            if (!safe)
                (page || await this.getCurrentPage()).close()
            else {
                let bot = this
                const numberOfOpenPages = (await bot.browser.pages()).length
                if (numberOfOpenPages <= 1) {
                    return
                }
                return await new Promise((resolve) => {
                    if (page) {
                        page.close().catch(e => { }).finally(resolve)
                    } else {
                        bot.getCurrentPage().then(p => {
                            p.close().finally(resolve)
                        }).catch(e => {
                        }).finally(resolve)
                    }
                })

            }

        } catch (e) { console.log('Non-Fatal: while closing current page.', e.message) }
    }

    async stopBrowser() {
        this.disconnectCount = 100
        try {
            (await this.getCurrentPage()).close()
        } catch (e) { console.log('Warning: closing current page', e.message) }
        try {
            await this.browser.disconnect()
        } catch (e) { console.log('Warning: disconnecting from browser', e.message) }
        try {
            clearInterval(this.periodicRuleTimer)
        } catch (e) { console.log('Warning: clearing scheduled rules', e.message) }
    }

    async init() {
        try {
            if (this.browser && this.browser.isConnected()) {
                console.log("alredy initialized")
                let that = this;
                if (that.defaultUrl && that.browser) {
                    that.gotoPage(that.defaultUrl)
                }
                return true
            }
            let browser;
            if (!this.browserURL)
                this.browserURL = 'http://127.0.0.1:21222/devtools/browser'
            if (!this.launchNewBrowser)
                browser = await connect({
                    browserURL: this.browserURL + '/' + this.profileName, defaultViewport: null
                });
            else
                browser = await launch({
                    defaultViewport: null
                })
            this.browser = browser;

            let that = this
            browser.on('disconnected', async () => {
                // if (that.debug)
                that.disconnectCount++
                while (that.disconnectCount < 10) {
                    await new Promise((resolve) => {
                        setTimeout(resolve, that.disconnectCount * 2000)
                    })
                    console.log('Browser disconnected. Trying to reconnect...' + that.disconnectCount);
                    await that.init()
                    if (that.defaultUrl && that.browser) {
                        that.gotoPage(that.defaultUrl)
                    }
                }
            });
            this.evaluatePeriodicRules()
            return true;
        } catch (e) {
            this.log(e)
            return false
        }
    }

    async getCurrentPage(url) {
        const pages = await this.browser.pages();
        let visiblePage;
        for (const page of pages) {
            const visibilityState = await page.evaluate(() => document.visibilityState);
            if (visibilityState === 'visible' || (url && page.url().indexOf(url) > -1)) {
                visiblePage = page;
                break;
            }
        }
        if (!visiblePage) {
            visiblePage = pages[0]
        }
        return visiblePage
    }

    async gotoPage(url, pageToUse) {
        if (!this.browser) {
            console.log("Fatal error while gotoPage. Browser Disconnected")
            this.init()
            return
        }
        const page = pageToUse || (await this.browser.newPage());

        this.attachRuleListenerToPage(page)
        await this._onNewPageLoading(page)
        await page.goto(url);

    }

    async _onNewPageLoading(page) {
        this.page = page
        if (this.keepSingleTabInBrowser)
            closeTabsExceptCurrent(this.browser, page)
        // try {
        //     await page.waitForNavigation();
        // } catch (e) {
        //     console.log("Tolerable Timeout Error")
        // }

        try {
            if (this.showMouse) {
                page.evaluate(showMouseJs)
                    .then(() => {
                        this.log("Mouse visalization connected")
                    })
            }
        } catch (e) {

        }


        await page.setRequestInterception(true);
        let that = this
        page.on('request', async (request) => {
            let headers = request.headers()
            let method = request.method()
            let url = request.url()
            let body = request.postData()
            let requestOverrides = {}
            if (request.isNavigationRequest() && request.resourceType() === 'document') {
                if (that.debug)
                    that.log('New page loading:' + request.url());
                try {

                    page.on('targetcreated', async (target) => {
                        const newPage = await target.page();
                        that.log('New page opened:', newPage.url());
                        that.attachRuleListenerToPage(newPage)
                        that._onNewPageLoading(newPage)
                    });

                } catch (e) {
                    console.warn("Fatal: Waiting for new page @ ", request.url(), " failed. " + e.message)
                }
            }
            else {

                let that = this

                let reqData = {
                    headers: request.headers(),
                    method: request.method(),
                    url: request.url(),
                    body: request.postData(),
                    reqId: request.reqId
                }
                Object.keys(that.globalReqResCallbacks).forEach(iurl => {
                    let cb = that.globalReqResCallbacks[iurl]
                    if (url.indexOf(iurl) > -1)
                        requestOverrides = cb(reqData, undefined, request) || {}

                })
                that.reqResCallbacks[page]?.forEach(cb => {
                    cb(reqData, undefined, request)
                })
            }

            try {
                if (!request.isInterceptResolutionHandled()) {
                    request.continue(requestOverrides);
                }
            } catch (e) {
                console.log(e.message)
            }
        });

        page.on('error', (err) => {
            console.error('Page error:', err);
        });

        page.on('close', (request) => {
            this.reqResCallbacks[page] = undefined
        });

        page.on('response', async (response) => {
            let body;
            const url = response.url()
            const headers = response.headers()
            const status = response.status()
            const timing = response.timing()?.requestTime
            const request = response.request()
            const reqId = request._requestId


            let reqData = {
                headers: request.headers(),
                method: request.method(),
                url: request.url(),
                body: request.postData(),
                reqId: reqId
            }

            try {
                body = await response.text();
            } catch (e) {
                this.log("Error loading text body ", url, e.message)
                body = undefined
            }
            let responseData = {
                headers,
                status,
                timing,
                method: request.method(),
                url,
                body,
                reqId
            }
            Object.keys(this.globalReqResCallbacks).forEach(iurl => {
                let cb = this.globalReqResCallbacks[iurl]
                if (url.indexOf(iurl) > -1)
                    cb(reqData, responseData, request, response)
            })
            this.reqResCallbacks[page]?.forEach(cb => {
                cb(reqData, responseData, request, response)
            })
        });
    }

    async closeBrowser() {
        await browser.close();
    }

    attachRuleListenerToPage(page) {
        let that = this;
        page.on('load', (param) => {
            if (that.debug) {
                that.log('Page loaded ', page.url())
            }
            that.evauateAllRules(page)
        })
    }

    periodicRuleTimer
    evaluatePeriodicRules() {
        let that = this
        if (this.periodicRuleTimer)
            clearInterval(this.periodicRuleTimer)
        this.periodicRuleTimer = setInterval(() => {

            let periodicRules = that.rules.filter(rule => {
                return rule.globalEvalPeriodMs != undefined &&
                    rule.globalEvalPeriodMs > BrowserBot.PERIODIC_INTERVAL
            })

            if (that.page) {
                this.log(`Evaluating periodic ${periodicRules.length} rules @ page `, that.page?.url())
                periodicRules.forEach(rule => {
                    if (rule.nextEvalAfter == undefined)
                        rule.nextEvalAfter = Date.now()

                    if (rule.nextEvalAfter <= Date.now()) {
                        rule.nextEvalAfter = Date.now() + rule.globalEvalPeriodMs
                        that.evaluateSingleRule(that.page, rule)
                    }
                })
            }
        }, BrowserBot.PERIODIC_INTERVAL)
    }

    evauateAllRules(page) {
        {
            this.log('Evaluating rules for page', page.url())
        }
        this.rules.forEach(rule => {
            this.evaluateSingleRule(page, rule)
        })
    }

    async evaluateSingleRule(page, curRule, retryCount) {
        let { partialUrl, elementPath, action, onActionDone, globalEvalPeriodMs, matcherType = 'xpath' } = curRule

        if (!onActionDone) {
            onActionDone = () => { }
        }
        let removeRule = () => {
            if (this.rules && typeof this.rules == 'object') {
                var indexToRemove = this.rules.indexOf(curRule);
                if (indexToRemove !== -1) {
                    this.rules.splice(indexToRemove, 1);
                }
            }
            if (this.periodicRules && typeof this.periodicRules == 'object') {
                indexToRemove = this.periodicRules.indexOf(curRule);
                if (indexToRemove !== -1) {
                    this.periodicRules.splice(indexToRemove, 1);
                }
            }

        }
        let url = page.url()
        if (partialUrl?.trim() == '*' || url.indexOf(partialUrl) > -1) {

            this.log(`page ${url} matches ${partialUrl}`)
            try {

                if (elementPath == '*') {
                    this.log(`wildcard element match`)

                    try {
                        await action(page, page, removeRule)
                        onActionDone(true)
                    } catch (e) {
                        this.log('Error evaluating action', elementPath)
                        if (this.debug) {
                            this.log(e)
                        }
                        if (e.message.indexOf("Session closed.") > -1) {
                            await this.init()
                        }
                        onActionDone(false, e)
                    }
                    return
                }
                let match
                if (matcherType == 'selector') {
                    match = await page.$(elementPath);
                }
                else if (matcherType == 'xpath') {
                    match = await page.$x(elementPath);
                }
                else if (matcherType == '$$') {
                    match = await page.$$(elementPath);
                }
                else if (matcherType == 'iframe') {
                    const iframes = await page.$$('iframe');
                    for (const iframe of iframes) {
                        const frameTitle = await iframe.evaluate(frame => frame.title);
                        if (frameTitle.indexOf(elementPath) > -1) {
                            match = [iframe]
                            break
                        }
                    }
                }
                if (match && match[0]) {
                    match = match[0]

                    this.log(`matche found for ${elementPath}`)
                    try {
                        await action(match, page, removeRule)
                        onActionDone(true)
                    } catch (e) {
                        this.log('Error evaluating action', elementPath)
                        if (this.debug) {
                            this.log(e)
                        }
                        if (e.message.indexOf("Session closed.") > -1) {
                            await this.init()
                        }
                        onActionDone(false, e)
                    }

                }
                else {
                    this.log(`NO MATCH FOR ${elementPath}`)
                    onActionDone(false, new Error('NO_MATCH'))
                }
            } catch (e) {
                retryCount = retryCount == undefined ? 1 : retryCount
                if (e.message.indexOf("closed") > -1 && retryCount > 0) {
                    this.log('Trying to recover from session closed error')
                    this.page = await this.getCurrentPage()
                    this.evaluateSingleRule(page, curRule, retryCount - 1)
                } else {
                    this.log('Error evaluating xpath', elementPath, e)
                    onActionDone(false, new Error('NO_MATCH'))
                }
            }


        }
    }

    attachOnRequestResponseListener(page, callback) {
        if (!this.reqResCallbacks[page])
            this.reqResCallbacks[page] = []
        this.reqResCallbacks[page].push(callback)
    }

    attachGlobalOnRequestResponseListener(url, callback) {
        this.globalReqResCallbacks[url] = (callback)
    }

    /*
     * matcherType = xpath | selector | iframe | $$
     */
    addRule({ partialUrl, elementPath, action, onActionDone, matcherType = 'xpath', globalEvalPeriodMs }) {
        if (globalEvalPeriodMs && globalEvalPeriodMs < 1000) {
            throw new Error("globalEvalPeriodMs must be at least 1000")
        }
        const index = this.rules.findIndex(
            obj =>
                obj.partialUrl === partialUrl &&
                obj.elementPath === elementPath
        );
        if (index !== -1) {
            this.rules.splice(index, 1);
        }
        this.rules.push({
            partialUrl, elementPath, action, onActionDone, globalEvalPeriodMs, matcherType
        })
    }


    async evaluateApiStream(page, url, method, headers, body, extraFetchParams) {
        let resp = await page.evaluate(this._doFetch, url, method, headers, body, extraFetchParams, true)
        return resp
    }

    async evaluateApi(page, url, method, headers, body, extraFetchParams) {
        let resp = await page.evaluate(this._doFetch, url, method, headers, body, extraFetchParams, false)
        return resp
    }


    async _doFetch(url, method, headers, body, extraFetchParams = {}, doStream) {
        if (typeof body != 'string')
            body = JSON.stringify(body)
        let fresp;
        let response = fetch(url, Object.assign({
            "headers": headers,
            "body": method.toLowerCase() == 'get' ? undefined : body,
            "method": method,
            "referrerPolicy": "same-origin",
            "mode": "cors",
            "credentials": "include",
            stream: doStream
        }, extraFetchParams))


        let status
        let resheaders
        if (!doStream) {
            let responseBody = await response
            status = responseBody.status
            resheaders = responseBody.headers
            fresp = await responseBody.text()
        }
        else {
            let responseBody = await response
            status = responseBody.status
            resheaders = responseBody.headers
            const reader = responseBody.body.getReader()
            let responseChunks = []
            while (true) {
                const { done, value } = await reader.read();
                const decoder = new TextDecoder('utf-8');
                const str = decoder.decode(value);
                responseChunks.push(str)

                if (done) {
                    fresp = responseChunks
                    break;
                }
            }

        }
        return {
            data: fresp,
            status: status,
            headers: resheaders
        }
    }

    static async clearInputField(inputField) {
        await inputField.click({ clickCount: 3 });
        await inputField.press('Backspace');
        await inputField.press('End');

    }

}

function generateRandomString(length) {
    const buffer = randomBytes(Math.ceil(length / 2));
    const hexString = buffer.toString('hex');
    return hexString.slice(0, length);
}


async function closeTabsExceptCurrent(browser, currentPage) {
    const pages = await browser.pages();

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (page !== currentPage) {
            try {
                await page.close();
            } catch (E) {

            }
        }
    }
}

export default BrowserBot