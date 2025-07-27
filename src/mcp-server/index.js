#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const axios = require('axios');
const cheerio = require('cheerio');
const Sentiment = require('sentiment');

class NewsScrapingMCPServer {
    constructor() {
        this.server = new Server(
            {
                name: 'news-scraping-server',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.sentiment = new Sentiment();
        this.setupToolHandlers();
    }

    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: 'scan_news_headlines',
                        description: 'Scan news headlines for mentions of specific topics and analyze sentiment',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                topic: {
                                    type: 'string',
                                    description: 'The topic to search for (e.g., "cryptocurrency", "bitcoin")',
                                },
                                sources: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'News sources to scan',
                                    default: ['reuters', 'bloomberg', 'cnbc', 'marketwatch']
                                },
                                max_articles: {
                                    type: 'number',
                                    description: 'Maximum number of articles to analyze',
                                    default: 50
                                }
                            },
                            required: ['topic'],
                        },
                    },
                    {
                        name: 'scan_social_media',
                        description: 'Scan social media feeds for topic mentions and sentiment',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                topic: {
                                    type: 'string',
                                    description: 'The topic to search for',
                                },
                                platforms: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'Social media platforms to scan',
                                    default: ['twitter', 'reddit']
                                },
                                max_posts: {
                                    type: 'number',
                                    description: 'Maximum number of posts to analyze',
                                    default: 100
                                }
                            },
                            required: ['topic'],
                        },
                    },
                    {
                        name: 'extract_stock_tickers',
                        description: 'Extract stock ticker symbols from text content',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                text: {
                                    type: 'string',
                                    description: 'Text content to analyze for stock tickers',
                                },
                                topic: {
                                    type: 'string',
                                    description: 'The main topic being analyzed',
                                }
                            },
                            required: ['text', 'topic'],
                        },
                    }
                ],
            };
        });

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            try {
                switch (name) {
                    case 'scan_news_headlines':
                        return await this.scanNewsHeadlines(args);
                    case 'scan_social_media':
                        return await this.scanSocialMedia(args);
                    case 'extract_stock_tickers':
                        return await this.extractStockTickers(args);
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: ${error.message}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }

    async scanNewsHeadlines(args) {
        const { topic, sources = ['reuters', 'bloomberg', 'cnbc', 'marketwatch'], max_articles = 50 } = args;
        const results = [];

        for (const source of sources) {
            try {
                const articles = await this.scrapeNewsSource(source, topic, max_articles / sources.length);
                results.push(...articles);
            } catch (error) {
                console.error(`Error scraping ${source}:`, error.message);
            }
        }

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        topic,
                        total_articles: results.length,
                        articles: results
                    }, null, 2),
                },
            ],
        };
    }

    async scrapeNewsSource(source, topic, maxArticles) {
        const articles = [];
        
        // This is a simplified implementation - in production, you'd use proper APIs
        // For demonstration, we'll simulate news scraping
        const mockArticles = this.generateMockNewsArticles(source, topic, maxArticles);
        
        for (const article of mockArticles) {
            const sentimentResult = this.sentiment.analyze(article.content);
            const sentiment = sentimentResult.score > 0 ? 'positive' : 'negative';
            const confidence = Math.abs(sentimentResult.score) / 10; // Normalize to 0-1
            
            const tickers = this.extractTickersFromContent(article.content, topic);
            
            articles.push({
                source,
                url: article.url,
                title: article.title,
                content: article.content,
                sentiment,
                confidence_score: confidence,
                tickers,
                timestamp: new Date().toISOString()
            });
        }

        return articles;
    }

    generateMockNewsArticles(source, topic, count) {
        const articles = [];
        const topicVariations = this.getTopicVariations(topic);
        
        for (let i = 0; i < count; i++) {
            const variation = topicVariations[Math.floor(Math.random() * topicVariations.length)];
            const sentiment = Math.random() > 0.5 ? 'positive' : 'negative';
            
            articles.push({
                url: `https://${source}.com/article-${i}-${Date.now()}`,
                title: this.generateMockTitle(variation, sentiment),
                content: this.generateMockContent(variation, sentiment)
            });
        }
        
        return articles;
    }

    getTopicVariations(topic) {
        const variations = {
            'cryptocurrency': ['Bitcoin', 'Ethereum', 'BTC', 'ETH', 'crypto', 'blockchain', 'digital currency'],
            'bitcoin': ['Bitcoin', 'BTC', 'cryptocurrency', 'digital gold'],
            'ethereum': ['Ethereum', 'ETH', 'smart contracts', 'DeFi'],
            'stock': ['stocks', 'equity', 'shares', 'market', 'trading']
        };
        
        return variations[topic.toLowerCase()] || [topic];
    }

    generateMockTitle(topic, sentiment) {
        const positiveTemplates = [
            `${topic} Surges as Institutional Adoption Grows`,
            `${topic} Reaches New Milestone in Market Performance`,
            `Analysts Bullish on ${topic} Future Prospects`
        ];
        
        const negativeTemplates = [
            `${topic} Faces Regulatory Pressure and Market Concerns`,
            `${topic} Drops Amid Market Uncertainty`,
            `Experts Warn of ${topic} Volatility Risks`
        ];
        
        const templates = sentiment === 'positive' ? positiveTemplates : negativeTemplates;
        return templates[Math.floor(Math.random() * templates.length)];
    }

    generateMockContent(topic, sentiment) {
        const positiveContent = `Recent developments in ${topic} show strong market confidence with increased institutional investment and positive regulatory signals. Market analysts are optimistic about future growth prospects.`;
        
        const negativeContent = `${topic} faces challenges with regulatory uncertainty and market volatility. Concerns about sustainability and market manipulation continue to weigh on investor sentiment.`;
        
        return sentiment === 'positive' ? positiveContent : negativeContent;
    }

    extractTickersFromContent(content, topic) {
        // Common cryptocurrency and stock ticker patterns
        const cryptoTickers = {
            'bitcoin': 'BTC',
            'ethereum': 'ETH',
            'cardano': 'ADA',
            'solana': 'SOL',
            'dogecoin': 'DOGE'
        };
        
        const tickers = [];
        const lowerContent = content.toLowerCase();
        
        // Extract crypto tickers
        for (const [name, ticker] of Object.entries(cryptoTickers)) {
            if (lowerContent.includes(name) || lowerContent.includes(ticker.toLowerCase())) {
                tickers.push(ticker);
            }
        }
        
        // Extract stock tickers (simplified pattern matching)
        const stockPattern = /\b[A-Z]{1,5}\b/g;
        const matches = content.match(stockPattern) || [];
        tickers.push(...matches.filter(match => match.length <= 4));
        
        return [...new Set(tickers)]; // Remove duplicates
    }

    async scanSocialMedia(args) {
        const { topic, platforms = ['twitter', 'reddit'], max_posts = 100 } = args;
        const results = [];

        // Simulate social media scanning
        for (const platform of platforms) {
            const posts = this.generateMockSocialPosts(platform, topic, max_posts / platforms.length);
            results.push(...posts);
        }

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        topic,
                        total_posts: results.length,
                        posts: results
                    }, null, 2),
                },
            ],
        };
    }

    generateMockSocialPosts(platform, topic, count) {
        const posts = [];
        
        for (let i = 0; i < count; i++) {
            const sentiment = Math.random() > 0.5 ? 'positive' : 'negative';
            const content = this.generateMockSocialContent(topic, sentiment);
            const sentimentResult = this.sentiment.analyze(content);
            
            posts.push({
                platform,
                url: `https://${platform}.com/post-${i}-${Date.now()}`,
                content,
                sentiment: sentimentResult.score > 0 ? 'positive' : 'negative',
                confidence_score: Math.abs(sentimentResult.score) / 10,
                tickers: this.extractTickersFromContent(content, topic),
                timestamp: new Date().toISOString()
            });
        }
        
        return posts;
    }

    generateMockSocialContent(topic, sentiment) {
        const positiveContent = [
            `Just bought more ${topic}! To the moon! 🚀`,
            `${topic} is looking strong today, great fundamentals`,
            `Bullish on ${topic} long term, this is just the beginning`
        ];
        
        const negativeContent = [
            `${topic} is overvalued, time to sell`,
            `Not feeling good about ${topic} lately, too much volatility`,
            `${topic} concerns me with all the regulatory issues`
        ];
        
        const content = sentiment === 'positive' ? positiveContent : negativeContent;
        return content[Math.floor(Math.random() * content.length)];
    }

    async extractStockTickers(args) {
        const { text, topic } = args;
        const tickers = this.extractTickersFromContent(text, topic);
        
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        topic,
                        tickers,
                        text_analyzed: text.substring(0, 200) + '...'
                    }, null, 2),
                },
            ],
        };
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('News Scraping MCP Server running on stdio');
    }
}

if (require.main === module) {
    const server = new NewsScrapingMCPServer();
    server.run().catch(console.error);
}

module.exports = { NewsScrapingMCPServer };
