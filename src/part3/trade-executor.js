class TradeExecutor {
    constructor(database) {
        this.db = database;
        this.tradingAPI = new MockTradingAPI(); // In production, use real trading API
        this.maxInvestmentPercent = 0.10; // 10% of available funds
    }

    async executeTrades() {
        console.log('Starting trade execution...');
        
        // Get unprocessed analysis data with trading actions
        const analysisData = await this.getUnprocessedAnalysisData();
        
        if (analysisData.length === 0) {
            console.log('No unprocessed trading actions found');
            return;
        }

        // Group by ticker and action type
        const tradeGroups = this.groupTradesByTickerAndAction(analysisData);
        
        for (const [key, entries] of Object.entries(tradeGroups)) {
            const [ticker, actionType] = key.split('|');
            try {
                await this.executeTradeGroup(ticker, actionType, entries);
            } catch (error) {
                console.error(`Error executing trades for ${ticker} (${actionType}):`, error.message);
            }
        }

        console.log('Trade execution completed');
    }

    async executeTradeGroup(ticker, actionType, analysisEntries) {
        try {
            // Get current account balance
            const accountBalance = await this.getAccountBalance();
            
            // Get current portfolio position for this ticker
            const currentPosition = await this.getCurrentPosition(ticker);
            
            // Determine trade parameters
            const tradeParams = await this.calculateTradeParameters(
                ticker, actionType, analysisEntries, accountBalance, currentPosition
            );

            if (!tradeParams) {
                console.log(`No trade executed for ${ticker} - insufficient conditions`);
                await this.markAnalysisAsProcessed(analysisEntries, 'skipped', 'Insufficient conditions');
                return;
            }

            // Execute the trade
            const tradeResult = await this.executeTrade(tradeParams);
            
            // Record the trade execution
            await this.recordTradeExecution(analysisEntries, tradeParams, tradeResult);
            
            // Update portfolio and account balance
            if (tradeResult.status === 'executed') {
                await this.updatePortfolio(ticker, actionType, tradeParams, tradeResult);
                await this.updateAccountBalance(tradeParams, tradeResult);
            }

            console.log(`Trade executed: ${actionType} ${tradeParams.quantity} shares of ${ticker} at $${tradeParams.price}`);

        } catch (error) {
            console.error(`Error executing trade group for ${ticker}:`, error.message);
            await this.markAnalysisAsProcessed(analysisEntries, 'failed', error.message);
        }
    }

    async calculateTradeParameters(ticker, actionType, analysisEntries, accountBalance, currentPosition) {
        const latestAnalysis = analysisEntries[0]; // Most recent analysis
        const currentPrice = latestAnalysis.current_stock_price;

        if (actionType === 'buy') {
            return await this.calculateBuyParameters(ticker, currentPrice, accountBalance);
        } else if (actionType === 'short') {
            return await this.calculateShortSellParameters(ticker, currentPrice, accountBalance, currentPosition);
        }

        return null;
    }

    async calculateBuyParameters(ticker, currentPrice, accountBalance) {
        const maxInvestment = accountBalance.available_funds * this.maxInvestmentPercent;
        
        if (maxInvestment < currentPrice) {
            console.log(`Insufficient funds for ${ticker}: Need $${currentPrice}, max investment $${maxInvestment}`);
            return null;
        }

        const quantity = Math.floor(maxInvestment / currentPrice);
        const totalCost = quantity * currentPrice;

        return {
            ticker,
            actionType: 'buy',
            quantity,
            price: currentPrice,
            totalAmount: totalCost
        };
    }

    async calculateShortSellParameters(ticker, currentPrice, accountBalance, currentPosition) {
        // Check if we currently own this stock
        if (currentPosition && currentPosition.quantity > 0) {
            // We own the stock, so we'll sell it
            return {
                ticker,
                actionType: 'sell',
                quantity: currentPosition.quantity,
                price: currentPrice,
                totalAmount: currentPosition.quantity * currentPrice
            };
        } else {
            // We don't own the stock, so we'll short it
            const maxInvestment = accountBalance.available_funds * this.maxInvestmentPercent;
            const quantity = Math.floor(maxInvestment / currentPrice);
            
            if (quantity === 0) {
                console.log(`Insufficient funds to short ${ticker}`);
                return null;
            }

            return {
                ticker,
                actionType: 'short',
                quantity,
                price: currentPrice,
                totalAmount: quantity * currentPrice
            };
        }
    }

    async executeTrade(tradeParams) {
        try {
            // Use the trading API to execute the trade
            const result = await this.tradingAPI.executeTrade(tradeParams);
            
            return {
                status: 'executed',
                executedPrice: result.executedPrice,
                executedQuantity: result.executedQuantity,
                executionTime: new Date().toISOString(),
                transactionId: result.transactionId
            };

        } catch (error) {
            console.error(`Trade execution failed:`, error.message);
            return {
                status: 'failed',
                error: error.message,
                executionTime: new Date().toISOString()
            };
        }
    }

    async recordTradeExecution(analysisEntries, tradeParams, tradeResult) {
        for (const analysis of analysisEntries) {
            try {
                await this.db.run(`
                    INSERT INTO trade_executions (
                        stock_analysis_id, ticker_symbol, action_type, quantity, 
                        price, total_amount, execution_status, error_message, 
                        created_at, executed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    analysis.id,
                    tradeParams.ticker,
                    tradeParams.actionType,
                    tradeParams.quantity,
                    tradeParams.price,
                    tradeParams.totalAmount,
                    tradeResult.status,
                    tradeResult.error || null,
                    new Date().toISOString(),
                    tradeResult.executionTime
                ]);

                // Mark analysis as processed
                await this.db.run(`
                    UPDATE stock_analysis 
                    SET processed = TRUE 
                    WHERE id = ?
                `, [analysis.id]);

            } catch (error) {
                console.error('Error recording trade execution:', error.message);
            }
        }
    }

    async updatePortfolio(ticker, actionType, tradeParams, tradeResult) {
        if (tradeResult.status !== 'executed') return;

        const currentPosition = await this.getCurrentPosition(ticker);
        
        let newQuantity = 0;
        let newAveragePrice = 0;
        let newTotalInvested = 0;

        if (actionType === 'buy') {
            if (currentPosition) {
                // Add to existing position
                const totalShares = currentPosition.quantity + tradeParams.quantity;
                const totalValue = (currentPosition.quantity * currentPosition.average_price) + 
                                 (tradeParams.quantity * tradeResult.executedPrice);
                
                newQuantity = totalShares;
                newAveragePrice = totalValue / totalShares;
                newTotalInvested = currentPosition.total_invested + tradeParams.totalAmount;
            } else {
                // New position
                newQuantity = tradeParams.quantity;
                newAveragePrice = tradeResult.executedPrice;
                newTotalInvested = tradeParams.totalAmount;
            }
        } else if (actionType === 'sell') {
            if (currentPosition) {
                newQuantity = Math.max(0, currentPosition.quantity - tradeParams.quantity);
                newAveragePrice = currentPosition.average_price; // Keep same average price
                newTotalInvested = Math.max(0, currentPosition.total_invested - 
                    (tradeParams.quantity * currentPosition.average_price));
            }
        } else if (actionType === 'short') {
            // For shorts, we track as negative quantity
            newQuantity = currentPosition ? currentPosition.quantity - tradeParams.quantity : -tradeParams.quantity;
            newAveragePrice = tradeResult.executedPrice;
            newTotalInvested = currentPosition ? currentPosition.total_invested : 0;
        }

        // Update or insert portfolio record
        if (currentPosition) {
            await this.db.run(`
                UPDATE portfolio 
                SET quantity = ?, average_price = ?, total_invested = ?, last_updated = ?
                WHERE ticker_symbol = ?
            `, [newQuantity, newAveragePrice, newTotalInvested, new Date().toISOString(), ticker]);
        } else {
            await this.db.run(`
                INSERT INTO portfolio (ticker_symbol, quantity, average_price, total_invested, last_updated)
                VALUES (?, ?, ?, ?, ?)
            `, [ticker, newQuantity, newAveragePrice, newTotalInvested, new Date().toISOString()]);
        }
    }

    async updateAccountBalance(tradeParams, tradeResult) {
        if (tradeResult.status !== 'executed') return;

        const currentBalance = await this.getAccountBalance();
        let newAvailableFunds = currentBalance.available_funds;

        if (tradeParams.actionType === 'buy' || tradeParams.actionType === 'short') {
            // Reduce available funds
            newAvailableFunds -= tradeParams.totalAmount;
        } else if (tradeParams.actionType === 'sell') {
            // Increase available funds
            newAvailableFunds += tradeParams.totalAmount;
        }

        await this.db.run(`
            UPDATE account_balance 
            SET available_funds = ?, last_updated = ?
            WHERE id = 1
        `, [newAvailableFunds, new Date().toISOString()]);
    }

    async getAccountBalance() {
        const balance = await this.db.get(`
            SELECT * FROM account_balance WHERE id = 1
        `);
        
        return balance || { available_funds: 0, total_portfolio_value: 0 };
    }

    async getCurrentPosition(ticker) {
        return await this.db.get(`
            SELECT * FROM portfolio WHERE ticker_symbol = ?
        `, [ticker]);
    }

    groupTradesByTickerAndAction(analysisData) {
        const groups = {};
        
        for (const entry of analysisData) {
            const key = `${entry.ticker_symbol}|${entry.action_type}`;
            if (!groups[key]) {
                groups[key] = [];
            }
            groups[key].push(entry);
        }
        
        return groups;
    }

    async getUnprocessedAnalysisData() {
        return await this.db.all(`
            SELECT * FROM stock_analysis 
            WHERE processed = FALSE AND action_type IS NOT NULL
            ORDER BY created_at DESC
        `);
    }

    async markAnalysisAsProcessed(analysisEntries, status, errorMessage = null) {
        for (const analysis of analysisEntries) {
            try {
                await this.db.run(`
                    INSERT INTO trade_executions (
                        stock_analysis_id, ticker_symbol, action_type, 
                        execution_status, error_message, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    analysis.id,
                    analysis.ticker_symbol,
                    analysis.action_type,
                    status,
                    errorMessage,
                    new Date().toISOString()
                ]);

                await this.db.run(`
                    UPDATE stock_analysis 
                    SET processed = TRUE 
                    WHERE id = ?
                `, [analysis.id]);

            } catch (error) {
                console.error('Error marking analysis as processed:', error.message);
            }
        }
    }

    // Method to get portfolio summary
    async getPortfolioSummary() {
        const positions = await this.db.all(`
            SELECT * FROM portfolio WHERE quantity != 0
        `);
        
        const balance = await this.getAccountBalance();
        
        return {
            positions,
            accountBalance: balance,
            totalPositions: positions.length
        };
    }

    // Method to get trade history
    async getTradeHistory(limit = 50) {
        return await this.db.all(`
            SELECT te.*, sa.sentiment_match, sa.prediction_confidence
            FROM trade_executions te
            LEFT JOIN stock_analysis sa ON te.stock_analysis_id = sa.id
            ORDER BY te.created_at DESC
            LIMIT ?
        `, [limit]);
    }
}

// Mock Trading API for demonstration
class MockTradingAPI {
    async executeTrade(tradeParams) {
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Simulate occasional failures (5% chance)
        if (Math.random() < 0.05) {
            throw new Error('Trading API temporarily unavailable');
        }

        // Simulate price slippage (±0.5%)
        const slippage = (Math.random() - 0.5) * 0.01;
        const executedPrice = tradeParams.price * (1 + slippage);

        return {
            executedPrice,
            executedQuantity: tradeParams.quantity,
            transactionId: `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };
    }

    // Method to check account status
    async getAccountStatus() {
        return {
            status: 'active',
            buyingPower: 10000,
            dayTradesRemaining: 3
        };
    }

    // Method to get current market price
    async getCurrentPrice(ticker) {
        // Mock current price - in production, this would fetch real market data
        const basePrices = {
            'BTC': 45000,
            'ETH': 3000,
            'ADA': 1.2,
            'SOL': 100,
            'DOGE': 0.08
        };
        
        const basePrice = basePrices[ticker] || 100;
        const variation = (Math.random() - 0.5) * 0.1; // ±5% variation
        
        return basePrice * (1 + variation);
    }
}

module.exports = { TradeExecutor };
