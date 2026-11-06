const sqlite3 = require('sqlite3');

// Errors worth waiting on: they mean another connection is holding the write lock. Overlapping
// transactions on this one connection are not such an error - see the queue below.
const isRetryable = (error) => error && (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED');

// A sqlite3 connection can hold exactly one transaction at a time, and this app hands the same
// connection to every request (config/db.js) and to every route file, each of which builds its
// own DatabaseHelper. So the queue is keyed by connection, not by helper: two requests reaching
// two different helpers would otherwise still collide. Unserialised, request B's BEGIN fails with
// `SQLITE_ERROR: cannot start a transaction within a transaction` (not BUSY, so it is never
// retried), B's catch issues a ROLLBACK that throws away A's open transaction, and A then
// continues in autocommit and leaves half of its mutation behind.
const transactionQueues = new WeakMap();

class DatabaseHelper {
    constructor(db) {
        this.db = db;
    }

    async _withRetry(method, sql, params, maxRetries, delay) {
        let lastError;

        for (let i = 0; i < maxRetries; i++) {
            try {
                return await new Promise((resolve, reject) => {
                    // `run` resolves with the statement itself so callers can read lastID/changes.
                    this.db[method](sql, params, function (err, rowOrRows) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(method === 'run' ? this : rowOrRows);
                        }
                    });
                });
            } catch (error) {
                lastError = error;
                if (!isRetryable(error) || i === maxRetries - 1) {
                    throw error;
                }
                // Exponential backoff with some randomization
                const backoff = delay * Math.pow(2, i) * (0.9 + Math.random() * 0.2);
                await new Promise(resolve => setTimeout(resolve, backoff));
            }
        }

        throw lastError;
    }

    runWithRetry(sql, params = [], maxRetries = 5, delay = 200) {
        return this._withRetry('run', sql, params, maxRetries, delay);
    }

    getWithRetry(sql, params = [], maxRetries = 5, delay = 200) {
        return this._withRetry('get', sql, params, maxRetries, delay);
    }

    allWithRetry(sql, params = [], maxRetries = 5, delay = 200) {
        return this._withRetry('all', sql, params, maxRetries, delay);
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

    // Last-ditch cleanup for a connection that may still be sitting inside a transaction. It must
    // not retry and must never throw: the caller is already reporting a more interesting error.
    async _forceRollback() {
        try {
            await new Promise((resolve) => {
                this.db.run('ROLLBACK', () => resolve());
            });
        } catch (ignored) {
            // Nothing left to do. A "no transaction is active" reply is the usual, harmless case.
        }
    }

    withTransaction(callback) {
        const previous = transactionQueues.get(this.db) || Promise.resolve();
        const run = () => this._withTransactionOnce(callback);
        const result = previous.then(run, run);
        // The chain must outlive any single caller's failure, so store a settled-only link.
        transactionQueues.set(this.db, result.then(() => {}, () => {}));
        return result;
    }

    async _withTransactionOnce(callback) {
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
                        // A failed rollback can leave the shared connection mid-transaction, which
                        // would poison every request queued behind this one - including our own
                        // retry below. Give it one unconditional try; the caller still receives the
                        // original error, not the one from this last-ditch attempt.
                        await this._forceRollback();
                    }
                }

                if ((error.code !== 'SQLITE_BUSY' && error.code !== 'SQLITE_LOCKED') ||
                    retries === maxRetries - 1) {
                    throw error;
                }

                retries++;
                await new Promise(resolve => setTimeout(resolve, 200 * Math.pow(2, retries)));
            }
        }
    }
}

module.exports = DatabaseHelper;
