'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const sequelize_1 = require("sequelize");
const test_batch_1 = require("../test-batch");
const logger_1 = require("../utils/logger");
const env = process.env.NODE_ENV === 'development' ? 'development' : 'production';
const config = require(path_1.default.join(__dirname, '/../config/config.json'))[env];
const db = {};
let sequelize;
if (config.use_env_variable) {
    sequelize = new sequelize_1.Sequelize(process.env[config.use_env_variable] || '', config);
}
else {
    sequelize = new sequelize_1.Sequelize(config.database || '', config.username || '', config.password || '', config);
}
// Import models
const FixMessage_1 = __importDefault(require("./FixMessage"));
// Add models to db object
db.FixMessage = FixMessage_1.default;
db.sequelize = sequelize;
db.Sequelize = sequelize_1.Sequelize;
// Run test batch after database initialization
sequelize.authenticate()
    .then(async () => {
    logger_1.logger.info('Database connection established successfully.');
    try {
        const totalSaved = await (0, test_batch_1.testBatchInsert)();
        logger_1.logger.info(`Test batch completed. Total messages saved: ${totalSaved}`);
    }
    catch (error) {
        logger_1.logger.error('Error running test batch:', error);
    }
})
    .catch(err => {
    logger_1.logger.error('Unable to connect to the database:', err);
});
exports.default = db;
