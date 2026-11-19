import Ajv, { ErrorObject } from 'ajv';

let ajvInstance: Ajv | undefined;

function getAjv(): Ajv {
    if (!ajvInstance) {
        ajvInstance = new Ajv({
            allErrors: true,
            strict: false,
            validateSchema: false
        });
    }
    return ajvInstance;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
    if (!errors || errors.length === 0) {
        return 'Invalid builder options.';
    }
    return errors.map(error => {
        const path = error.instancePath || '/';
        return `${path}: ${error.message}`;
    }).join('\n');
}

export function validateBuilderOptionsAgainstSchema(
    schema: object, options: unknown): string | undefined {
    const validate = getAjv().compile(schema);
    return validate(options) ? undefined : formatErrors(validate.errors);
}
