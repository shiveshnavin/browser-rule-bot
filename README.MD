# Browser Rule Bot
A robust rule based browser automation tool. Rules can be added to the bot with URL based filters. These rules will be avaluated and correspoding actions will be called when the filter matches.

## Installation
```
npm install browser-rule-bot
```

## Usage
You can either launch a new browser or connect to an existing browser.
For example to connect to a chromium already open you can launch chromium browser using the the extra flags. This will be especially helpful if you want to use extensions and use your default browser to automate your personal accounts on wesites.
```bash
"/path/to/chrome" --remote-debugging-port=21222
```
You might also want to open developer tools automatically.
```
"/path/to/chrome" --remote-debugging-port=21222 --auto-open-devtools-for-tabs
```
```js
import BrowserBot from 'browserbot';

let profile = 'Detault' //'Default' if you want to use the default local profile or the name of the profile to use
let defaultUrl = "https://en.wikipedia.org/wiki/Main_Page" //The default url to open when the bot is started
let launchNewBrowser = false // true if you want to launch a new browser, false if you want to connect to an already open browser
const browserBot = new BrowserBot(profile, defaultUrl,launchNewBrowser);
browserBot.init().then(()=>{
    console.log('Browserbot initialized')
    browserBot.gotoPage(defaultUrl)
})
browserBot.debug = 1 // Optional, Recommended if you want to view additional logging which can help debug issues finding elements
```

### Rule Syntax
The rule object passed to `browserBot.addRule()` has following options

- `partialUrl` : If the current page url contains this value then the rule will be evaluated. In case '*' is set as partialUrl then the rule is evaluated on each page
- `matcherType` : 
    - `xpath` - match by XPath
    - `iframe` - match iframes by iframe title
    - `selector` - match by CSS selector
    - Default value is `xpath`
- `elementPath` : 
    - if `matcherType=xpath` then xpath of the element
    - if `matcherType=iframe` then title of iframe
    - if `matcherType=selector` then the CSS selector
    - if `*` then the whole page will be sent as the element
- `globalEvalPeriodMs` : If you want to evalute this rule periodically, pass the period in miliseconds  
- `action` : callback which will be called on match of element.
- `onActionDone` : optional callback which will be called after rule is evaluated

### Adding Basic Rules
Add some rules based on page url
```js

    browserBot.addRule({
        partialUrl: "/wiki/Main_Page", // you can put partial of full url. This rule will be evaluated only when the url matches. Using `*` as partialUrl makes the rule to be evaluated on every page
        elementPath: `//*[@id="vector-main-menu-dropdown-checkbox"]`, // XPath for the element your want to find
        action: async function (hamButton, page) { // Reference to pupeteer element and page
            await hamButton.click() 
        },
        onActionDone: async function (isSuccess, err) { // optional callback function which will be called after rule is evaluated
            if (isSuccess) {
                console.log('action completed successfully')
            }
            else {
                console.log('action failed',err)
            }
        }
    })

```
### Evaluating Rules in Sequence
The rules added via `addRule()` are evaluated in parallel, In case you want to sequence actions then you can evaluate nested rules.
```js

    browserBot.addRule({
        partialUrl: "/wiki/Main_Page",
        elementPath: `//*[@id="vector-main-menu-dropdown-checkbox"]`, 
        action: async function (hamButton, page) { 
            await hamButton.click()

            browserBot.evaluateSingleRule(page, {
                partialUrl: "*",
                elementPath: `//*[@id="n-randompage"]/a`,
                action: async function (continueButton, page) {
                    await continueButton.click()
                }
            }) 

        },
        onActionDone: async function (isSuccess, err) {
            if (isSuccess){
                console.log('action completed successfully)
            }
            else{
                console.log('action failed',err)
            }
        }
    })

```

### Evaluating periodic rules
If you want to evaluate a rule periodically, for example to check if there is a session expired popup, this will be quite helpful.
```js
    browserBot.addRule({
        globalEvalPeriodMs: 5100,
        matcherType: 'iframe',
        partialUrl: "https://iframetester.com/?url=https://wikipedia.org",
        elementPath: 'Wikipedia',
        action: async function (iframe, page) {
           
        }
    })
```


### Intercepting XHR and other Network requests
You can also recieve readonly hooks when browser makes network requests.
```js
let partialUrl = "/wiki/Main_Page"
let callback = (req, res) => {
    if (req)
        console.log('request', {
            headers: req.headers,
            method: req.method,
            url: req.url,
            body: req.body,
            reqId: req.reqId
        })

    if (res)
        console.log('response', {
            headers: res.headers,
            status: res.status,
            timing: res.timing,
            method: res.method,
            url: res.url,
            body: res.body,
            reqId: res.reqId
        })
}
browserBot.attachGlobalOnRequestResponseListener(partialUrl, callback)
```