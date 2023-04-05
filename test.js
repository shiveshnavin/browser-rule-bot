import BrowserBot from './index.js';

let profile = 'Detault' //'Default' if you want to use the default local profile or the name of the profile to use
let defaultUrl = "https://en.wikipedia.org/wiki/Main_Page" //The default url to open when the bot is started
let launchNewBrowser = false // true if you want to launch a new browser, false if you want to connect to an already open browser
const browserBot = new BrowserBot(launchNewBrowser, profile, defaultUrl);
browserBot.init().then(() => {
    console.log('Browserbot initialized')
    browserBot.gotoPage(defaultUrl)
})

browserBot.addRule({
    partialUrl: "/wiki/Main_Page",
    elementPath: `//*[@id="vector-main-menu-dropdown-checkbox"]`,
    action: async function (hamButton, page) {
        await hamButton.click()
        await page.screenshot({ path: 'wikipedia.png' });
        await new Promise((resolve) => setTimeout(resolve, 3000))
        browserBot.evaluateSingleRule(page, {
            partialUrl: "*",
            elementPath: `//*[@id="n-randompage"]/a`,
            action: async function (continueButton, page) {
                await continueButton.click()
            }
        })
    },
    onActionDone: async function (isSuccess, err) {
        if (isSuccess) {
            console.log('action completed successfully')
        }
        else {
            console.log('action failed', err)
        }
    }
})