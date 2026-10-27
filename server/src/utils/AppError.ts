export class AppError extends Error {
    constructor(
        public statusCode: number,
        message: string,
        public code: string,
        public isOperational = true
    ) {
        super(message);
        this.name = 'AppError';
    }
}