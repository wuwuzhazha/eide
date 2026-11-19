import X2JS = require('x2js');

export class SvdParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SvdParseError';
    }
}

export interface SvdAddressBlock {
    offset: number;
    size: number;
    usage?: string;
}

export interface SvdField {
    name: string;
    description?: string;
    bitOffset: number;
    bitWidth: number;
    access?: string;
}

export interface SvdRegister {
    name: string;
    description?: string;
    addressOffset: number;
    address: number;
    size: number;
    access?: string;
    resetValue?: number;
    fields: SvdField[];
    peripheralName: string;
}

export interface SvdPeripheral {
    name: string;
    description?: string;
    baseAddress: number;
    addressBlocks: SvdAddressBlock[];
    registers: SvdRegister[];
}

export interface SvdDevice {
    name: string;
    version?: string;
    description?: string;
    addressUnitBits: number;
    width: number;
    peripherals: SvdPeripheral[];
}

export interface SvdRegisterMatch {
    peripheral: SvdPeripheral;
    register: SvdRegister;
    offset: number;
}

export interface SvdPeripheralMatch {
    peripheral: SvdPeripheral;
    offset: number;
}

interface DimensionExpansion {
    name: string;
    value: number;
}

interface RegisterLocation {
    start: number;
    end: number;
    peripheral: SvdPeripheral;
    register: SvdRegister;
}

interface PeripheralLocation {
    start: number;
    end: number;
    peripheral: SvdPeripheral;
}

export function parseSvd(xml: string): SvdDevice {
    const document = parseXml(xml);
    const root = asObject(document.device, 'device');
    const name = requireText(root, 'name', 'device');
    const addressUnitBits = optionalUnsigned(root, 'addressUnitBits', 'device') ?? 8;
    const width = optionalUnsigned(root, 'width', 'device') ?? 32;
    if (addressUnitBits <= 0 || width <= 0) {
        throw new SvdParseError('device: addressUnitBits and width must be positive');
    }
    if (root.peripherals === undefined) {
        throw new SvdParseError('device: missing <peripherals>');
    }
    const peripheralNodes =
        root.peripherals === ''
            ? []
            : toArray(asObject(root.peripherals, 'device.peripherals').peripheral);
    const peripherals: SvdPeripheral[] = [];
    for (let index = 0; index < peripheralNodes.length; index++) {
        peripherals.push(
            ...parsePeripheral(peripheralNodes[index], `device.peripherals.peripheral[${index}]`, width),
        );
    }
    return {
        name,
        version: optionalText(root, 'version', 'device'),
        description: optionalText(root, 'description', 'device'),
        addressUnitBits,
        width,
        peripherals,
    };
}

export class SvdModel {
    readonly device: SvdDevice;

    private readonly peripheralByName = new Map<string, SvdPeripheral>();
    private readonly registerByPeripheral = new Map<string, Map<string, SvdRegister>>();
    private readonly registersByName = new Map<string, SvdRegister[]>();
    private readonly registerLocations: RegisterLocation[] = [];
    private readonly peripheralLocations: PeripheralLocation[] = [];

    constructor(device: SvdDevice) {
        this.device = device;
        for (const peripheral of device.peripherals) {
            if (this.peripheralByName.has(peripheral.name)) {
                throw new SvdParseError(`duplicate peripheral name: ${peripheral.name}`);
            }
            this.peripheralByName.set(peripheral.name, peripheral);
            const registers = new Map<string, SvdRegister>();
            for (const register of peripheral.registers) {
                if (registers.has(register.name)) {
                    throw new SvdParseError(
                        `duplicate register name ${register.name} in peripheral ${peripheral.name}`,
                    );
                }
                registers.set(register.name, register);
                const named = this.registersByName.get(register.name);
                if (named === undefined) {
                    this.registersByName.set(register.name, [register]);
                } else {
                    named.push(register);
                }
                this.registerLocations.push({
                    start: register.address,
                    end: register.address + Math.ceil(register.size / 8),
                    peripheral,
                    register,
                });
            }
            this.registerByPeripheral.set(peripheral.name, registers);
            for (const block of peripheral.addressBlocks) {
                const start = peripheral.baseAddress + block.offset;
                this.peripheralLocations.push({
                    start,
                    end: start + block.size,
                    peripheral,
                });
            }
        }
        this.registerLocations.sort((left, right) => left.start - right.start);
        this.peripheralLocations.sort((left, right) => left.start - right.start);
    }

    static parse(xml: string): SvdModel {
        return new SvdModel(parseSvd(xml));
    }

    findPeripheral(name: string): SvdPeripheral | undefined {
        return this.peripheralByName.get(name);
    }

    findRegister(peripheralName: string, registerName: string): SvdRegister | undefined {
        return this.registerByPeripheral.get(peripheralName)?.get(registerName);
    }

    findRegisters(name: string): SvdRegister[] {
        return (this.registersByName.get(name) ?? []).slice();
    }

    findRegisterAt(address: number): SvdRegisterMatch | undefined {
        assertAddress(address);
        const location = findLocation(this.registerLocations, address);
        if (location === undefined) {
            return undefined;
        }
        return {
            peripheral: location.peripheral,
            register: location.register,
            offset: address - location.start,
        };
    }

    findPeripheralAt(address: number): SvdPeripheralMatch | undefined {
        assertAddress(address);
        const location = findLocation(this.peripheralLocations, address);
        if (location === undefined) {
            return undefined;
        }
        return { peripheral: location.peripheral, offset: address - location.start };
    }
}

function parseXml(xml: string): Record<string, any> {
    let document: unknown;
    try {
        document = new X2JS({ attributePrefix: '$' }).xml2js<unknown>(xml);
    } catch (error) {
        throw new SvdParseError(`invalid SVD XML: ${messageOf(error)}`);
    }
    return asObject(document, 'document');
}

function parsePeripheral(
    value: unknown,
    path: string,
    deviceWidth: number,
): SvdPeripheral[] {
    const node = asObject(value, path);
    const name = requireText(node, 'name', path);
    const baseAddress = requireUnsigned(node, 'baseAddress', path);
    const peripheralSize = optionalUnsigned(node, 'size', path);
    const description = optionalText(node, 'description', path);
    const addressBlocks = parseAddressBlocks(node.addressBlock, `${path}.addressBlock`);
    const registerNodes =
        node.registers === undefined || node.registers === ''
            ? []
            : toArray(asObject(node.registers, `${path}.registers`).register);
    return expandDimension(node, path, name, baseAddress).map(expansion => {
        const registers: SvdRegister[] = [];
        for (let index = 0; index < registerNodes.length; index++) {
            registers.push(
                ...parseRegister(
                    registerNodes[index],
                    `${path}.registers.register[${index}]`,
                    expansion.name,
                    expansion.value,
                    peripheralSize,
                    deviceWidth,
                ),
            );
        }
        return {
            name: expansion.name,
            description,
            baseAddress: expansion.value,
            addressBlocks: addressBlocks.map(block => ({ ...block })),
            registers,
        };
    });
}

function parseRegister(
    value: unknown,
    path: string,
    peripheralName: string,
    peripheralBase: number,
    peripheralSize: number | undefined,
    deviceWidth: number,
): SvdRegister[] {
    const node = asObject(value, path);
    const name = requireText(node, 'name', path);
    const addressOffset = requireUnsigned(node, 'addressOffset', path);
    const size = optionalUnsigned(node, 'size', path) ?? peripheralSize ?? deviceWidth;
    if (size <= 0) {
        throw new SvdParseError(`${path}: register size must be positive`);
    }
    const description = optionalText(node, 'description', path);
    const access = optionalText(node, 'access', path);
    const resetValue = optionalUnsigned(node, 'resetValue', path);
    const fieldNodes =
        node.fields === undefined || node.fields === ''
            ? []
            : toArray(asObject(node.fields, `${path}.fields`).field);
    const fields = parseFields(fieldNodes, `${path}.fields`);
    return expandDimension(node, path, name, addressOffset).map(expansion => ({
        name: expansion.name,
        description,
        addressOffset: expansion.value,
        address: peripheralBase + expansion.value,
        size,
        access,
        resetValue,
        fields: fields.map(field => ({ ...field })),
        peripheralName,
    }));
}

function parseFields(values: unknown[], path: string): SvdField[] {
    const fields: SvdField[] = [];
    for (let index = 0; index < values.length; index++) {
        const fieldPath = `${path}.field[${index}]`;
        const node = asObject(values[index], fieldPath);
        const name = requireText(node, 'name', fieldPath);
        const description = optionalText(node, 'description', fieldPath);
        const access = optionalText(node, 'access', fieldPath);
        const range = readBitRange(node, fieldPath);
        for (const expansion of expandDimension(node, fieldPath, name, range.bitOffset)) {
            fields.push({
                name: expansion.name,
                description,
                bitOffset: expansion.value,
                bitWidth: range.bitWidth,
                access,
            });
        }
    }
    return fields;
}

function readBitRange(node: Record<string, any>, path: string): { bitOffset: number; bitWidth: number } {
    const bitOffset = optionalUnsigned(node, 'bitOffset', path);
    const bitWidth = optionalUnsigned(node, 'bitWidth', path);
    if (bitOffset !== undefined || bitWidth !== undefined) {
        if (bitOffset === undefined || bitWidth === undefined) {
            throw new SvdParseError(`${path}: bitOffset and bitWidth must be specified together`);
        }
        if (bitWidth === 0) {
            throw new SvdParseError(`${path}: bitWidth must be positive`);
        }
        return { bitOffset, bitWidth };
    }
    const lsb = optionalUnsigned(node, 'lsb', path);
    const msb = optionalUnsigned(node, 'msb', path);
    if (lsb !== undefined || msb !== undefined) {
        if (lsb === undefined || msb === undefined || msb < lsb) {
            throw new SvdParseError(`${path}: lsb and msb must be specified with msb >= lsb`);
        }
        return { bitOffset: lsb, bitWidth: msb - lsb + 1 };
    }
    const bitRange = optionalText(node, 'bitRange', path);
    if (bitRange !== undefined) {
        const match = /^\[\s*(\d+)\s*:\s*(\d+)\s*\]$/.exec(bitRange);
        if (match === null || Number(match[1]) < Number(match[2])) {
            throw new SvdParseError(`${path}: invalid bitRange: ${bitRange}`);
        }
        const rangeMsb = Number(match[1]);
        const rangeLsb = Number(match[2]);
        return { bitOffset: rangeLsb, bitWidth: rangeMsb - rangeLsb + 1 };
    }
    throw new SvdParseError(`${path}: field has no bit range`);
}

function parseAddressBlocks(value: unknown, path: string): SvdAddressBlock[] {
    return toArray(value).map((block, index) => {
        const blockPath = `${path}[${index}]`;
        const node = asObject(block, blockPath);
        const offset = requireUnsigned(node, 'offset', blockPath);
        const size = requireUnsigned(node, 'size', blockPath);
        if (size <= 0) {
            throw new SvdParseError(`${blockPath}: address block size must be positive`);
        }
        return { offset, size, usage: optionalText(node, 'usage', blockPath) };
    });
}

function expandDimension(
    node: Record<string, any>,
    path: string,
    nameTemplate: string,
    baseValue: number,
): DimensionExpansion[] {
    const dim = optionalUnsigned(node, 'dim', path);
    if (dim === undefined) {
        return [{ name: nameTemplate, value: baseValue }];
    }
    if (dim <= 0) {
        throw new SvdParseError(`${path}: dim must be positive`);
    }
    if (!nameTemplate.includes('%s')) {
        throw new SvdParseError(`${path}: dimensioned element name must contain %s: ${nameTemplate}`);
    }
    const increment = requireUnsigned(node, 'dimIncrement', path);
    const indices = expandDimIndices(dim, optionalText(node, 'dimIndex', path), `${path}.dimIndex`);
    return indices.map((index, position) => ({
        name: nameTemplate.split('%s').join(index),
        value: baseValue + position * increment,
    }));
}

function expandDimIndices(dim: number, dimIndex: string | undefined, path: string): string[] {
    if (dimIndex === undefined) {
        return Array.from({ length: dim }, (_, index) => String(index));
    }
    const indices: string[] = [];
    for (const item of dimIndex.split(',')) {
        const trimmed = item.trim();
        if (trimmed === '') {
            throw new SvdParseError(`${path}: invalid index list: ${dimIndex}`);
        }
        const range = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed);
        if (range === null) {
            indices.push(trimmed);
            continue;
        }
        const start = Number(range[1]);
        const end = Number(range[2]);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) {
            throw new SvdParseError(`${path}: invalid index range: ${trimmed}`);
        }
        if (end - start + 1 > dim) {
            throw new SvdParseError(`${path}: index range exceeds dim ${dim}: ${trimmed}`);
        }
        for (let value = start; value <= end; value++) {
            indices.push(String(value));
        }
    }
    if (indices.length !== dim) {
        throw new SvdParseError(`${path}: expected ${dim} indices but got ${indices.length}`);
    }
    return indices;
}

function findLocation<T extends { start: number; end: number }>(
    locations: readonly T[],
    address: number,
): T | undefined {
    let low = 0;
    let high = locations.length - 1;
    let candidate = -1;
    while (low <= high) {
        const middle = (low + high) >>> 1;
        if (locations[middle].start <= address) {
            candidate = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    for (let index = candidate; index >= 0 && locations[index].start <= address; index--) {
        if (address < locations[index].end) {
            return locations[index];
        }
    }
    return undefined;
}

function assertAddress(address: number): void {
    if (!Number.isSafeInteger(address) || address < 0) {
        throw new RangeError(`invalid address: ${String(address)}`);
    }
}

function asObject(value: unknown, path: string): Record<string, any> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new SvdParseError(`${path}: expected XML element`);
    }
    return value as Record<string, any>;
}

function toArray(value: unknown): any[] {
    if (value === undefined || value === '') {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function requireText(parent: Record<string, any>, key: string, path: string): string {
    const value = parent[key];
    if (typeof value !== 'string' || value.trim() === '') {
        throw new SvdParseError(`${path}.${key}: expected non-empty text`);
    }
    return value.trim();
}

function optionalText(parent: Record<string, any>, key: string, path: string): string | undefined {
    const value = parent[key];
    if (value === undefined || value === '') {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new SvdParseError(`${path}.${key}: expected text`);
    }
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
}

function requireUnsigned(parent: Record<string, any>, key: string, path: string): number {
    const value = parent[key];
    if (typeof value !== 'string' || value.trim() === '') {
        throw new SvdParseError(`${path}.${key}: expected a number`);
    }
    return parseSvdNumber(value, `${path}.${key}`);
}

function optionalUnsigned(parent: Record<string, any>, key: string, path: string): number | undefined {
    const value = parent[key];
    if (value === undefined || value === '') {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new SvdParseError(`${path}.${key}: expected a number`);
    }
    return parseSvdNumber(value, `${path}.${key}`);
}

function parseSvdNumber(text: string, path: string): number {
    const trimmed = text.trim();
    let value: number;
    if (/^0x[0-9a-f]+$/i.test(trimmed)) {
        value = parseInt(trimmed.slice(2), 16);
    } else if (/^0b[01]+$/i.test(trimmed)) {
        value = parseInt(trimmed.slice(2), 2);
    } else if (/^#[01]+$/.test(trimmed)) {
        value = parseInt(trimmed.slice(1), 2);
    } else if (/^\d+$/.test(trimmed)) {
        value = parseInt(trimmed, 10);
    } else {
        throw new SvdParseError(`${path}: invalid number: ${trimmed}`);
    }
    if (!Number.isSafeInteger(value)) {
        throw new SvdParseError(`${path}: number exceeds the safe integer range: ${trimmed}`);
    }
    return value;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
