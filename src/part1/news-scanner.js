const { spawn } = require('child_process');
const path = require('path');

class NewsScanner {
    constructor(database) {
        this.db = database;
        this.mcpServerPath = path.join(__dirname, '../mcp-server/index.js');
        this.topics = ['cryptocurrency', 'bitcoin', 'ethereum']; // Default topics
    }

    async scanNews(customTopics = null) {
        const topics = customTopics || this.topics;
        console.log(`Starting news scan for topics: ${topics.join(', ')}`);

        for (const topic of topics) {
            try {
                await this.scanTopicNews(topic);
                await this.scanTopicSocialMedia(topic);
            } catch (error) {
                console.error(`Error scanning topic ${topic}:`, error.message);
            }
        }

        console.log('News scan completed');
    }

    async scanTopicNews(topic) {
        try {
            const newsData = await this.callMCPTool('scan_news_headlines', {
                topic,
                sources: ['reuters', 'bloomberg', 'cnbc', 'marketwatch'],
                max_articles: 20
            });

            if (newsData && newsData.articles) {
                for (const article of newsData.articles) {
                    await this.saveNewsData(article, topic);
                }
                console.log(`Processed ${newsData.articles.length} news articles for ${topic}`);
            }
        } catch (error) {
            console.error(`Error scanning news for ${topic}:`, error.message);
        }
    }

    async scanTopicSocialMedia(topic) {
        try {
            const socialData = await this.callMCPTool('scan_social_media', {
                topic,
                platforms: ['twitter', 'reddit'],
                max_posts: 30
            });

            if (socialData && socialData.posts) {
                for (const post of socialData.posts) {
                    await this.saveSocialData(post, topic);
                }
                console.log(`Processed ${socialData.posts.length} social media posts for ${topic}`);
            }
        } catch (error) {
            console.error(`Error scanning social media for ${topic}:`, error.message);
        }
    }

    async saveNewsData(article, topic) {
        // Extract the primary ticker for this article
        const primaryTicker = this.getPrimaryTicker(article.tickers, topic);
        
        if (!primaryTicker) {
            console.log(`No ticker found for article: ${article.title}`);
            return;
        }

        try {
            await this.db.run(`
                INSERT INTO news_sentiment (
                    ticker_symbol, source_url, title, content, 
                    sentiment, confidence_score, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                primaryTicker,
                article.url,
                article.title,
                article.content,
                article.sentiment,
                article.confidence_score,
                new Date().toISOString()
            ]);
        } catch (error) {
            console.error('Error saving news data:', error.message);
        }
    }

    async saveSocialData(post, topic) {
        // Extract the primary ticker for this post
        const primaryTicker = this.getPrimaryTicker(post.tickers, topic);
        
        if (!primaryTicker) {
            return; // Skip posts without identifiable tickers
        }

        try {
            await this.db.run(`
                INSERT INTO news_sentiment (
                    ticker_symbol, source_url, title, content, 
                    sentiment, confidence_score, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                primaryTicker,
                post.url,
                `${post.platform} post`,
                post.content,
                post.sentiment,
                post.confidence_score,
                new Date().toISOString()
            ]);
        } catch (error) {
            console.error('Error saving social data:', error.message);
        }
    }

    getPrimaryTicker(tickers, topic) {
        if (!tickers || tickers.length === 0) {
            return null;
        }

        // Priority mapping for topics to tickers
        const topicTickerMap = {
            'cryptocurrency': ['BTC', 'ETH', 'ADA', 'SOL', 'DOGE'],
            'bitcoin': ['BTC'],
            'ethereum': ['ETH'],
            'cardano': ['ADA'],
            'solana': ['SOL'],
            'dogecoin': ['DOGE']
        };

        const priorityTickers = topicTickerMap[topic.toLowerCase()] || [];
        
        // Find the highest priority ticker that exists in the article
        for (const priorityTicker of priorityTickers) {
            if (tickers.includes(priorityTicker)) {
                return priorityTicker;
            }
        }

        // If no priority ticker found, return the first ticker
        return tickers[0];
    }

    async callMCPTool(toolName, args) {
        return new Promise((resolve, reject) => {
            const mcpProcess = spawn('node', [this.mcpServerPath], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            mcpProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            mcpProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            mcpProcess.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`MCP server exited with code ${code}: ${stderr}`));
                    return;
                }

                try {
                    // Parse the JSON response from the MCP server
                    const lines = stdout.trim().split('\n');
                    let result = null;

                    for (const line of lines) {
                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.content && parsed.content[0] && parsed.content[0].text) {
                                result = JSON.parse(parsed.content[0].text);
                                break;
                            }
                        } catch (e) {
                            // Continue to next line
                        }
                    }

                    resolve(result);
                } catch (error) {
                    reject(new Error(`Failed to parse MCP response: ${error.message}`));
                }
            });

            // Send the tool call request
            const request = {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: {
                    name: toolName,
                    arguments: args
                }
            };

            mcpProcess.stdin.write(JSON.stringify(request) + '\n');
            mcpProcess.stdin.end();
        });
    }

    async getUnprocessedSentimentData() {
        return await this.db.all(`
            SELECT * FROM news_sentiment 
            WHERE processed = FALSE 
            ORDER BY created_at DESC
        `);
    }

    async markSentimentAsProcessed(id) {
        await this.db.run(`
            UPDATE news_sentiment 
            SET processed = TRUE 
            WHERE id = ?
        `, [id]);
    }

    // Method to manually add topics for scanning
    setTopics(topics) {
        this.topics = topics;
    }

    // Method to get current topics
    getTopics() {
        return this.topics;
    }
}

module.exports = { NewsScanner };
