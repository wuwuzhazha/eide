import { main } from './main';

main(process.argv.slice(2)).then(
    code => { process.exitCode = code; },
    error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 4;
    }
);
