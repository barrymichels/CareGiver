const sqlite3 = require('sqlite3');

class DatabaseHelper {
    constructor(db) {
        this.db = db;
    }

    async runWithRetry(sql, params = [], maxRetries = 5, delay = 200) {
        let lastError;
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await new Promise((resolve, reject) => {
                    this.db.run(sql, params, function(err) {
                        if (err) {
                            if (err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED') {
                                reject(err);
                            } else {
                                reject(err);
                            }
                        } else {
                            resolve(this);
                        }
                    });
                });
            } catch (error) {
                lastError = error;
                if ((error.code !== 'SQLITE_BUSY' && error.code !== 'SQLITE_LOCKED') || i === maxRetries - 1) {
                    throw error;
                }
                // Exponential backoff with some randomization
                const backoff = delay * Math.pow(2, i) * (0.9 + Math.random() * 0.2);
                await new Promise(resolve => setTimeout(resolve, backoff));
            }
        }
        
        throw lastError;
    }

    async getWithRetry(sql, params = [], maxRetries = 5, delay = 200) {
        let lastError;
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await new Promise((resolve, reject) => {
                    this.db.get(sql, params, (err, row) => {
                        if (err) {
                            if (err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED') {
                                reject(err);
                            } else {
                                reject(err);
                            }
                        } else {
                            resolve(row);
                        }
                    });
                });
            } catch (error) {
                lastError = error;
                if ((error.code !== 'SQLITE_BUSY' && error.code !== 'SQLITE_LOCKED') || i === maxRetries - 1) {
                    throw error;
                }
                const backoff = delay * Math.pow(2, i) * (0.9 + Math.random() * 0.2);
                await new Promise(resolve => setTimeout(resolve, backoff));
            }
        }
        
        throw lastError;
    }

    async allWithRetry(sql, params = [], maxRetries = 5, delay = 200) {
        let lastError;
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await new Promise((resolve, reject) => {
                    this.db.all(sql, params, (err, rows) => {
                        if (err) {
                            if (err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED') {
                                reject(err);
                            } else {
                                reject(err);
                            }
                        } else {
                            resolve(rows);
                        }
                    });
                });
            } catch (error) {
                lastError = error;
                if ((error.code !== 'SQLITE_BUSY' && error.code !== 'SQLITE_LOCKED') || i === maxRetries - 1) {
                    throw error;
                }
                const backoff = delay * Math.pow(2, i) * (0.9 + Math.random() * 0.2);
                await new Promise(resolve => setTimeout(resolve, backoff));
            }
        }
        
        throw lastError;
    }

    async beginTransaction() {
        await this.runWithRetry('BEGIN IMMEDIATE TRANSACTION');
    }

    async commit() {
        await this.runWithRetry('COMMIT');
    }

    async rollback() {
        try {
            await this.runWithRetry('ROLLBACK');
        } catch (error) {
            console.error('Error during rollback:', error);
            throw error;
        }
    }

    async withTransaction(callback) {
        let retries = 0;
        const maxRetries = 3;
        let transactionStarted = false;
        
        while (retries < maxRetries) {
            try {
                await this.beginTransaction();
                transactionStarted = true;
                const result = await callback();
                await this.commit();
                return result;
            } catch (error) {
                if (transactionStarted) {
                    try {
                        await this.rollback();
                    } catch (rollbackError) {
                        // Only log rollback errors if there was actually a transaction to roll back
                        if (!rollbackError.message.includes('no transaction is active')) {
                            console.error('Rollback failed:', rollbackError);
                        }
                    }
                }
                
                if (error.code !== 'SQLITE_BUSY' && error.code !== 'SQLITE_LOCKED' || retries === maxRetries - 1) {
                    throw error;
                }
                
                retries++;
                await new Promise(resolve => setTimeout(resolve, 200 * Math.pow(2, retries)));
            }
        }
    }
}

module.exports = DatabaseHelper; 