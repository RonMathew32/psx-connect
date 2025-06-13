import { Sequelize } from 'sequelize';

const sequelize = new Sequelize(process.env.DB_NAME || '', process.env.DB_USER || '', process.env.DB_PASSWORD || '', {
    host: process.env.DB_HOST || '',
    dialect: 'mysql',
    logging: false, // or true for SQL logs
});

export default sequelize;