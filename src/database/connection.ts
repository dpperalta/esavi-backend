import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';
import path from 'path';

const env = process.env.NODE_ENV || 'development';

dotenv.config({ 
    path: path.resolve(process.cwd(), `.env.${env}`)
});

const {
    DB_HOST,
    DB_PORT,
    DB_NAME,
    DB_USER,
    DB_PASSWORD,
    DB_SSL
} = process.env;

if( !DB_HOST || !DB_PORT || !DB_NAME || !DB_USER || !DB_PASSWORD ) {
    throw new Error('Missing required database configuration in environment variables');
}

export const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
    host: DB_HOST,
    port: parseInt(DB_PORT, 10),
    dialect: 'postgres',
    logging: env === 'development' ? console.log : false,
    dialectOptions: DB_SSL === 'true' ? {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    } : undefined
});

export const connectDatabase = async (): Promise<void> => {
    try {
        await sequelize.authenticate();
        console.log('ESAVI DB connected successfully');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
        throw error;
    }
}