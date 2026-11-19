import { Logger } from './adapters';

export class StderrLogger implements Logger {
    info(message: string): void {
        process.stderr.write(message + '\n');
    }

    warn(message: string): void {
        process.stderr.write('Warning: ' + message + '\n');
    }

    error(message: string | Error): void {
        const text = message instanceof Error ? message.message : message;
        process.stderr.write('Error: ' + text + '\n');
    }
}
