const yahooFinance = require('yahoo-finance2').default;

class StockAnalyzer {
    constructor(database) {
        this.db = database;
        this.predictionModels = [
            new TechnicalAnalysisModel(),
            new SentimentMomentumModel(),
            new VolumeAnalysisModel()
        ];
    }

    async analyzeStocks() {
        console.log('Starting stock analysis...');
        
        // Get unprocessed sentiment data
        const sentimentData = await this.getUnprocessedSentimentData();
        
        if (sentimentData.length === 0) {
            console.log('No unprocessed sentiment data found');
            return;
        }

        // Group by ticker symbol
        const tickerGroups = this.groupByTicker(sentimentData);
        
        for (const [ticker, entries] of Object.entries(tickerGroups)) {
            try {
                await this.analyzeTickerStock(ticker, entries);
            } catch (error) {
                console.error(`Error analyzing ${ticker}:`, error.message);
            }
        }

        console.log('Stock analysis completed');
    }

    async analyzeTickerStock(ticker, sentimentEntries) {
        try {
            // Get stock price data for the last 24 hours
            const stockData = await this.getStockData(ticker);
            
            if (!stockData) {
                console.log(`No stock data available for ${ticker}`);
                return;
            }

            // Aggregate sentiment for this ticker
            const aggregatedSentiment = this.aggregateSentiment(sentimentEntries);
            
            // Run prediction models
            const predictions = await this.runPredictionModels(ticker, stockData, aggregatedSentiment);
            
            // Determine final prediction
            const finalPrediction = this.consolidatePredictions(predictions);
            
            // Check if sentiment matches prediction
            const sentimentMatch = this.checkSentimentMatch(aggregatedSentiment.sentiment, finalPrediction.direction);
            
            if (sentimentMatch) {
                // Create trading action
                const actionType = this.determineActionType(aggregatedSentiment.sentiment, finalPrediction.direction);
                
                // Save analysis results
                for (const entry of sentimentEntries) {
                    await this.saveStockAnalysis(entry, stockData, finalPrediction, actionType, sentimentMatch);
                }
                
                console.log(`${ticker}: Sentiment (${aggregatedSentiment.sentiment}) matches prediction (${finalPrediction.direction}) - Action: ${actionType}`);
            } else {
                console.log(`${ticker}: Sentiment (${aggregatedSentiment.sentiment}) does not match prediction (${finalPrediction.direction}) - No action`);
            }

        } catch (error) {
            console.error(`Error analyzing ticker ${ticker}:`, error.message);
        }
    }

    async getStockData(ticker) {
        try {
            // For crypto tickers, we need to convert to proper symbols
            const symbol = this.convertTickerToSymbol(ticker);
            
            // Get historical data for the last 2 days
            const endDate = new Date();
            const startDate = new Date(endDate.getTime() - (2 * 24 * 60 * 60 * 1000));
            
            const historicalData = await yahooFinance.historical(symbol, {
                period1: startDate,
                period2: endDate,
                interval: '1h'
            });

            if (!historicalData || historicalData.length < 2) {
                return null;
            }

            const currentPrice = historicalData[historicalData.length - 1].close;
            const price24hAgo = historicalData[Math.max(0, historicalData.length - 24)].close;
            const priceChangePercent = ((currentPrice - price24hAgo) / price24hAgo) * 100;

            return {
                symbol,
                currentPrice,
                price24hAgo,
                priceChangePercent,
                historicalData,
                volume: historicalData[historicalData.length - 1].volume
            };

        } catch (error) {
            console.error(`Error fetching stock data for ${ticker}:`, error.message);
            return null;
        }
    }

    convertTickerToSymbol(ticker) {
        // Convert crypto tickers to Yahoo Finance symbols
        const cryptoMap = {
            'BTC': 'BTC-USD',
            'ETH': 'ETH-USD',
            'ADA': 'ADA-USD',
            'SOL': 'SOL-USD',
            'DOGE': 'DOGE-USD'
        };

        return cryptoMap[ticker] || ticker;
    }

    groupByTicker(sentimentData) {
        const groups = {};
        
        for (const entry of sentimentData) {
            if (!groups[entry.ticker_symbol]) {
                groups[entry.ticker_symbol] = [];
            }
            groups[entry.ticker_symbol].push(entry);
        }
        
        return groups;
    }

    aggregateSentiment(entries) {
        let positiveCount = 0;
        let negativeCount = 0;
        let totalConfidence = 0;

        for (const entry of entries) {
            if (entry.sentiment === 'positive') {
                positiveCount++;
            } else {
                negativeCount++;
            }
            totalConfidence += entry.confidence_score || 0.5;
        }

        const overallSentiment = positiveCount > negativeCount ? 'positive' : 'negative';
        const averageConfidence = totalConfidence / entries.length;

        return {
            sentiment: overallSentiment,
            confidence: averageConfidence,
            positiveCount,
            negativeCount,
            totalEntries: entries.length
        };
    }

    async runPredictionModels(ticker, stockData, sentiment) {
        const predictions = [];

        for (const model of this.predictionModels) {
            try {
                const prediction = await model.predict(ticker, stockData, sentiment);
                predictions.push(prediction);
            } catch (error) {
                console.error(`Error running prediction model ${model.constructor.name}:`, error.message);
            }
        }

        return predictions;
    }

    consolidatePredictions(predictions) {
        if (predictions.length === 0) {
            return { direction: 'neutral', confidence: 0.5 };
        }

        let increaseVotes = 0;
        let decreaseVotes = 0;
        let totalConfidence = 0;

        for (const prediction of predictions) {
            if (prediction.direction === 'increase') {
                increaseVotes += prediction.confidence;
            } else if (prediction.direction === 'decrease') {
                decreaseVotes += prediction.confidence;
            }
            totalConfidence += prediction.confidence;
        }

        const finalDirection = increaseVotes > decreaseVotes ? 'increase' : 'decrease';
        const finalConfidence = Math.max(increaseVotes, decreaseVotes) / totalConfidence;

        return {
            direction: finalDirection,
            confidence: finalConfidence
        };
    }

    checkSentimentMatch(sentiment, prediction) {
        return (sentiment === 'positive' && prediction === 'increase') ||
               (sentiment === 'negative' && prediction === 'decrease');
    }

    determineActionType(sentiment, prediction) {
        if (sentiment === 'positive' && prediction === 'increase') {
            return 'buy';
        } else if (sentiment === 'negative' && prediction === 'decrease') {
            return 'short';
        }
        return null;
    }

    async saveStockAnalysis(sentimentEntry, stockData, prediction, actionType, sentimentMatch) {
        try {
            const result = await this.db.run(`
                INSERT INTO stock_analysis (
                    ticker_symbol, news_sentiment_id, stock_price_24h_ago, 
                    current_stock_price, price_change_percent, prediction, 
                    prediction_confidence, sentiment_match, action_type, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                sentimentEntry.ticker_symbol,
                sentimentEntry.id,
                stockData.price24hAgo,
                stockData.currentPrice,
                stockData.priceChangePercent,
                prediction.direction,
                prediction.confidence,
                sentimentMatch,
                actionType,
                new Date().toISOString()
            ]);

            // Mark sentiment entry as processed
            await this.db.run(`
                UPDATE news_sentiment 
                SET processed = TRUE 
                WHERE id = ?
            `, [sentimentEntry.id]);

        } catch (error) {
            console.error('Error saving stock analysis:', error.message);
        }
    }

    async getUnprocessedSentimentData() {
        return await this.db.all(`
            SELECT * FROM news_sentiment 
            WHERE processed = FALSE 
            ORDER BY created_at DESC
        `);
    }

    async getUnprocessedAnalysisData() {
        return await this.db.all(`
            SELECT * FROM stock_analysis 
            WHERE processed = FALSE AND action_type IS NOT NULL
            ORDER BY created_at DESC
        `);
    }
}

// Technical Analysis Model
class TechnicalAnalysisModel {
    async predict(ticker, stockData, sentiment) {
        const { historicalData, priceChangePercent } = stockData;
        
        // Simple moving average analysis
        const prices = historicalData.map(d => d.close);
        const shortMA = this.calculateMA(prices.slice(-5), 5); // 5-period MA
        const longMA = this.calculateMA(prices.slice(-10), 10); // 10-period MA
        
        // RSI calculation (simplified)
        const rsi = this.calculateRSI(prices);
        
        let direction = 'neutral';
        let confidence = 0.5;
        
        // Trend analysis
        if (shortMA > longMA && rsi < 70) {
            direction = 'increase';
            confidence = 0.7;
        } else if (shortMA < longMA && rsi > 30) {
            direction = 'decrease';
            confidence = 0.7;
        }
        
        // Adjust confidence based on recent price movement
        if (Math.abs(priceChangePercent) > 5) {
            confidence += 0.1;
        }
        
        return { direction, confidence: Math.min(confidence, 1.0) };
    }
    
    calculateMA(prices, period) {
        if (prices.length < period) return prices[prices.length - 1];
        const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
        return sum / period;
    }
    
    calculateRSI(prices, period = 14) {
        if (prices.length < period + 1) return 50; // Default neutral RSI
        
        let gains = 0;
        let losses = 0;
        
        for (let i = prices.length - period; i < prices.length; i++) {
            const change = prices[i] - prices[i - 1];
            if (change > 0) {
                gains += change;
            } else {
                losses -= change;
            }
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        
        if (avgLoss === 0) return 100;
        
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }
}

// Sentiment Momentum Model
class SentimentMomentumModel {
    async predict(ticker, stockData, sentiment) {
        const { priceChangePercent } = stockData;
        
        let direction = sentiment.sentiment === 'positive' ? 'increase' : 'decrease';
        let confidence = sentiment.confidence;
        
        // Boost confidence if price movement aligns with sentiment
        if ((sentiment.sentiment === 'positive' && priceChangePercent > 0) ||
            (sentiment.sentiment === 'negative' && priceChangePercent < 0)) {
            confidence += 0.2;
        }
        
        // Consider sentiment strength
        if (sentiment.totalEntries > 5) {
            confidence += 0.1;
        }
        
        return { direction, confidence: Math.min(confidence, 1.0) };
    }
}

// Volume Analysis Model
class VolumeAnalysisModel {
    async predict(ticker, stockData, sentiment) {
        const { historicalData, volume } = stockData;
        
        // Calculate average volume
        const volumes = historicalData.map(d => d.volume || 0);
        const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
        
        let direction = 'neutral';
        let confidence = 0.5;
        
        // High volume with price movement suggests continuation
        if (volume > avgVolume * 1.5) {
            if (stockData.priceChangePercent > 0) {
                direction = 'increase';
                confidence = 0.6;
            } else if (stockData.priceChangePercent < 0) {
                direction = 'decrease';
                confidence = 0.6;
            }
        }
        
        return { direction, confidence };
    }
}

module.exports = { StockAnalyzer };
