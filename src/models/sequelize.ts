'use strict';

import fs from 'fs';
import path from 'path';
import { Sequelize, DataTypes } from 'sequelize';
import { testBatchInsert } from '../test-batch';
import { logger } from '../utils/logger';

const env = process.env.NODE_ENV === 'development' ? 'development' : 'production';
const config = require(path.join(__dirname, '/../config/config.json'))[env];

interface DB {
  [key: string]: any;
  sequelize: Sequelize;
  Sequelize: typeof Sequelize;
}

const db: DB = {} as DB;

let sequelize: Sequelize;
if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable] || '', config);
} else {
  sequelize = new Sequelize(
    config.database || '',
    config.username || '',
    config.password || '',
    config
  );
}

// Import models
import FixMessage from './FixMessage';

// Add models to db object
db.FixMessage = FixMessage;

db.sequelize = sequelize;
db.Sequelize = Sequelize;

// Run test batch after database initialization
sequelize.authenticate()
  .then(async () => {
    logger.info('Database connection established successfully.');
    // try {
    //   const totalSaved = await testBatchInsert();
    //   logger.info(`Test batch completed. Total messages saved: ${totalSaved}`);
    // } catch (error) {
    //   logger.error('Error running test batch:', error);
    // }
  })
  .catch(err => {
    logger.error('Unable to connect to the database:', err);
  });

export default db;
