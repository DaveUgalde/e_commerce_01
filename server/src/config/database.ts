import mongoose from 'mongoose'; // <-- Importación por defecto
import { logger } from './logger.js';

export async function connectDatabase(uri: string): Promise<void> {
  // Accedemos a 'connection' a través del objeto 'mongoose'
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB error'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  logger.info('MongoDB connected');
}

export async function disconnectDatabase(): Promise<void> { 
  await mongoose.disconnect(); 
}