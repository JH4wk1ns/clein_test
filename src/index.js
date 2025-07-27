const cron = require('node-cron');
const { NewsScanner } = require('./part1/news-scanner');
const { StockAnalyzer } = require('./part2/stock-analyzer');
const { TradeExecutor } = require('./part3/trade-executor');
const { Database } = require('./database/db');

class AutomatedTradingSystem {
    constructor() {
        this.db = new Database();
        this.newsScanner = new NewsScanner(this.db);
        this.stockAnalyzer = new StockAnalyzer(this.db);
        this.tradeExecutor = new TradeExecutor(this.db);
    }

    async initialize() {
        await this.db.initialize();
        console.log('Automated Trading System initialized');
    }

    async start() {
        await this.initialize();

        // Schedule Part 1: News scanning every 30 minutes
        cron.schedule('*/30 * * * *', async () => {
            console.log('Running news scan...');
            await this.newsScanner.scanNews();
        });

        // Schedule Part 2: Stock analysis every hour
        cron.schedule('0 * * * *', async () => {
            console.log('Running stock analysis...');
            await this.stockAnalyzer.analyzeStocks();
        });

        // Schedule Part 3: Trade execution every 2 hours
        cron.schedule('0 */2 * * *', async () => {
            console.log('Executing trades...');
            await this.tradeExecutor.executeTrades();
        });

        console.log('Automated Trading System started with scheduled tasks');
    }
}

if (require.main === module) {
    const system = new AutomatedTradingSystem();
    system.start().catch(console.error);
}

module.exports = { AutomatedTradingSystem };
