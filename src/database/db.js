const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor() {
        this.dbPath = path.join(__dirname, '../../data/trading.db');
        this.db = null;
    }

    async initialize() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                console.log('Connected to SQLite database');
                this.createTables().then(resolve).catch(reject);
            });
        });
    }

    async createTables() {
        const tables = [
            // Part 1: News sentiment data
            `CREATE TABLE IF NOT EXISTS news_sentiment (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker_symbol TEXT NOT NULL,
                source_url TEXT NOT NULL,
                title TEXT,
                content TEXT,
                sentiment TEXT CHECK(sentiment IN ('positive', 'negative')),
                confidence_score REAL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                processed BOOLEAN DEFAULT FALSE
            )`,
            
            // Part 2: Stock analysis and predictions
            `CREATE TABLE IF NOT EXISTS stock_analysis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker_symbol TEXT NOT NULL,
                news_sentiment_id INTEGER,
                stock_price_24h_ago REAL,
                current_stock_price REAL,
                price_change_percent REAL,
                prediction TEXT CHECK(prediction IN ('increase', 'decrease')),
                prediction_confidence REAL,
                sentiment_match BOOLEAN,
                action_type TEXT CHECK(action_type IN ('buy', 'sell', 'short')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                processed BOOLEAN DEFAULT FALSE,
                FOREIGN KEY (news_sentiment_id) REFERENCES news_sentiment (id)
            )`,
            
            // Part 3: Trade execution records
            `CREATE TABLE IF NOT EXISTS trade_executions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                stock_analysis_id INTEGER,
                ticker_symbol TEXT NOT NULL,
                action_type TEXT CHECK(action_type IN ('buy', 'sell', 'short')),
                quantity INTEGER,
                price REAL,
                total_amount REAL,
                execution_status TEXT CHECK(execution_status IN ('pending', 'executed', 'failed', 'skipped')),
                error_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                executed_at DATETIME,
                FOREIGN KEY (stock_analysis_id) REFERENCES stock_analysis (id)
            )`,
            
            // Portfolio tracking
            `CREATE TABLE IF NOT EXISTS portfolio (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker_symbol TEXT UNIQUE NOT NULL,
                quantity INTEGER DEFAULT 0,
                average_price REAL,
                total_invested REAL DEFAULT 0,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // Account balance tracking
            `CREATE TABLE IF NOT EXISTS account_balance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                available_funds REAL DEFAULT 10000,
                total_portfolio_value REAL DEFAULT 0,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const table of tables) {
            await this.run(table);
        }

        // Initialize account balance if not exists
        await this.run(`INSERT OR IGNORE INTO account_balance (id, available_funds) VALUES (1, 10000)`);
    }

    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row);
            });
        });
    }

    async all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows);
            });
        });
    }

    async close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) {
                    reject(err);
                    return;
                }
                console.log('Database connection closed');
                resolve();
            });
        });
    }
}

module.exports = { Database };
