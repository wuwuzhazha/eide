import {
    parseSvd,
    SvdField,
    SvdModel,
    SvdParseError,
    SvdRegister,
} from '../../src/core/debug/svd';

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
    console.log('OK:', message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
    assert(actual === expected, `${message} (expected ${String(expected)}, got ${String(actual)})`);
}

function assertParseError(action: () => void, message: string): void {
    try {
        action();
    } catch (error) {
        assert(error instanceof SvdParseError, `${message}: throws SvdParseError`);
        return;
    }
    throw new Error(`${message}: expected SvdParseError`);
}

function fieldNames(register: SvdRegister): string {
    return register.fields.map((field: SvdField) => field.name).join(',');
}

const SAMPLE_SVD = `<?xml version="1.0" encoding="utf-8"?>
<device schemaVersion="1.1">
  <name>TestDevice</name>
  <version>1.2.3</version>
  <description>Sample device</description>
  <addressUnitBits>8</addressUnitBits>
  <width>32</width>
  <peripherals>
    <peripheral>
      <name>GPIOA</name>
      <description>GPIO port A</description>
      <baseAddress>0x40020000</baseAddress>
      <addressBlock>
        <offset>0x0</offset>
        <size>0x400</size>
        <usage>registers</usage>
      </addressBlock>
      <registers>
        <register>
          <name>MODER</name>
          <description>Mode register</description>
          <addressOffset>0x00</addressOffset>
          <size>32</size>
          <resetValue>0xA8000000</resetValue>
          <fields>
            <field>
              <name>MODER0</name>
              <bitOffset>0</bitOffset>
              <bitWidth>2</bitWidth>
            </field>
            <field>
              <name>MODE%s</name>
              <dim>3</dim>
              <dimIncrement>2</dimIncrement>
              <bitOffset>4</bitOffset>
              <bitWidth>2</bitWidth>
            </field>
            <field>
              <name>LEGACY</name>
              <bitRange>[15:12]</bitRange>
            </field>
            <field>
              <name>LSBMSB</name>
              <lsb>8</lsb>
              <msb>10</msb>
            </field>
          </fields>
        </register>
        <register>
          <name>CR</name>
          <addressOffset>0x04</addressOffset>
        </register>
        <register>
          <name>IDR</name>
          <addressOffset>0x10</addressOffset>
        </register>
        <register>
          <name>ODR</name>
          <addressOffset>0x14</addressOffset>
          <size>16</size>
        </register>
        <register>
          <name>AFR%s</name>
          <dim>2</dim>
          <dimIncrement>4</dimIncrement>
          <dimIndex>L,H</dimIndex>
          <addressOffset>0x20</addressOffset>
          <fields>
            <field>
              <name>AFR%s</name>
              <dim>2</dim>
              <dimIncrement>4</dimIncrement>
              <bitOffset>0</bitOffset>
              <bitWidth>4</bitWidth>
            </field>
          </fields>
        </register>
      </registers>
    </peripheral>
    <peripheral>
      <name>TIM2</name>
      <baseAddress>0x40000000</baseAddress>
      <size>16</size>
      <addressBlock>
        <offset>0x0</offset>
        <size>0x400</size>
      </addressBlock>
      <registers>
        <register>
          <name>CR</name>
          <addressOffset>0x00</addressOffset>
        </register>
        <register>
          <name>CNT</name>
          <addressOffset>0x24</addressOffset>
        </register>
      </registers>
    </peripheral>
  </peripherals>
</device>`;

const model = SvdModel.parse(SAMPLE_SVD);
const device = model.device;
assertEqual(device.name, 'TestDevice', 'device name');
assertEqual(device.version, '1.2.3', 'device version');
assertEqual(device.description, 'Sample device', 'device description');
assertEqual(device.addressUnitBits, 8, 'device address unit bits');
assertEqual(device.width, 32, 'device width');
assertEqual(device.peripherals.length, 2, 'peripheral count');

const gpio = model.findPeripheral('GPIOA');
assert(gpio !== undefined, 'find peripheral by name');
assertEqual(gpio!.baseAddress, 0x40020000, 'peripheral base address');
assertEqual(gpio!.description, 'GPIO port A', 'peripheral description');
assertEqual(gpio!.addressBlocks.length, 1, 'address block count');
assertEqual(gpio!.addressBlocks[0].offset, 0, 'address block offset');
assertEqual(gpio!.addressBlocks[0].size, 0x400, 'address block size');
assertEqual(gpio!.addressBlocks[0].usage, 'registers', 'address block usage');
assertEqual(model.findPeripheral('NOPE'), undefined, 'unknown peripheral');

assertEqual(gpio!.registers.length, 6, 'expanded register count');
const moder = model.findRegister('GPIOA', 'MODER');
assert(moder !== undefined, 'find register by name');
assertEqual(moder!.address, 0x40020000, 'register address');
assertEqual(moder!.addressOffset, 0x00, 'register address offset');
assertEqual(moder!.size, 32, 'register size');
assertEqual(moder!.resetValue, 0xa8000000, 'register reset value');
assertEqual(moder!.peripheralName, 'GPIOA', 'register peripheral name');
assertEqual(moder!.description, 'Mode register', 'register description');
assertEqual(fieldNames(moder!), 'MODER0,MODE0,MODE1,MODE2,LEGACY,LSBMSB', 'register field names');
assertEqual(moder!.fields[0].bitOffset, 0, 'field bit offset');
assertEqual(moder!.fields[0].bitWidth, 2, 'field bit width');
assertEqual(moder!.fields[1].bitOffset, 4, 'dim field first offset');
assertEqual(moder!.fields[2].bitOffset, 6, 'dim field increment');
assertEqual(moder!.fields[3].bitOffset, 8, 'dim field last offset');
assertEqual(moder!.fields[4].bitOffset, 12, 'bitRange offset');
assertEqual(moder!.fields[4].bitWidth, 4, 'bitRange width');
assertEqual(moder!.fields[5].bitOffset, 8, 'lsb/msb offset');
assertEqual(moder!.fields[5].bitWidth, 3, 'lsb/msb width');

const idr = model.findRegister('GPIOA', 'IDR');
assert(idr !== undefined, 'inherited register size lookup');
assertEqual(idr!.size, 32, 'register size inherits device width');
const odr = model.findRegister('GPIOA', 'ODR');
assertEqual(odr!.size, 16, 'explicit register size');

const afrLow = model.findRegister('GPIOA', 'AFRL');
const afrHigh = model.findRegister('GPIOA', 'AFRH');
assert(afrLow !== undefined && afrHigh !== undefined, 'dimIndex register expansion');
assertEqual(afrLow!.address, 0x40020020, 'first dim register address');
assertEqual(afrHigh!.address, 0x40020024, 'second dim register address');
assertEqual(fieldNames(afrHigh!), 'AFR0,AFR1', 'dim field names');
assertEqual(afrHigh!.fields[1].bitOffset, 4, 'dim field bit increment');

const tim2Cnt = model.findRegister('TIM2', 'CNT');
assert(tim2Cnt !== undefined, 'find inherited peripheral size register');
assertEqual(tim2Cnt!.size, 16, 'register size inherits peripheral size');

assertEqual(model.findRegister('GPIOA', 'NOPE'), undefined, 'unknown register');
assertEqual(model.findRegister('NOPE', 'CR'), undefined, 'unknown peripheral register');

const crRegisters = model.findRegisters('CR');
assertEqual(crRegisters.length, 2, 'find registers across peripherals');
assertEqual(crRegisters[0].peripheralName, 'GPIOA', 'cross-peripheral register order');
assertEqual(model.findRegisters('NOPE').length, 0, 'unknown register name list');

const moderMatch = model.findRegisterAt(0x40020000);
assert(moderMatch !== undefined, 'find register at exact address');
assertEqual(moderMatch!.register.name, 'MODER', 'address match register');
assertEqual(moderMatch!.offset, 0, 'address match offset');
const idrOffset = model.findRegisterAt(0x40020012);
assert(idrOffset !== undefined, 'find register at interior address');
assertEqual(idrOffset!.register.name, 'IDR', 'interior address register');
assertEqual(idrOffset!.offset, 2, 'interior address offset');
assertEqual(model.findRegisterAt(0x40020016), undefined, 'address in register gap');
const afrOffset = model.findRegisterAt(0x40020027);
assert(afrOffset !== undefined, 'find dim register at interior address');
assertEqual(afrOffset!.register.name, 'AFRH', 'dim address register');
assertEqual(afrOffset!.offset, 3, 'dim address offset');
assertEqual(model.findRegisterAt(0x40020028), undefined, 'address after register range');
const cntMatch = model.findRegisterAt(0x40000025);
assert(cntMatch !== undefined, 'peripheral inherited size address lookup');
assertEqual(cntMatch!.register.name, 'CNT', 'peripheral inherited size address register');

const gpioBlock = model.findPeripheralAt(0x40020100);
assert(gpioBlock !== undefined, 'find peripheral at block address');
assertEqual(gpioBlock!.peripheral.name, 'GPIOA', 'peripheral block match');
assertEqual(gpioBlock!.offset, 0x100, 'peripheral block offset');
assertEqual(model.findPeripheralAt(0x40000400), undefined, 'address after address block');

let rangeError = false;
try {
    model.findRegisterAt(-1);
} catch (error) {
    rangeError = error instanceof RangeError;
}
assert(rangeError, 'negative address query throws RangeError');

const minimal = parseSvd(
    '<device><name>Minimal</name><peripherals><peripheral><name>P</name><baseAddress>0x1000</baseAddress><registers><register><name>R</name><addressOffset>0x0</addressOffset></register></registers></peripheral></peripherals></device>',
);
assertEqual(minimal.addressUnitBits, 8, 'default address unit bits');
assertEqual(minimal.width, 32, 'default device width');
assertEqual(minimal.peripherals[0].registers[0].size, 32, 'default register size');
assertEqual(minimal.peripherals[0].registers[0].address, 0x1000, 'minimal register address');
assertEqual(minimal.peripherals[0].addressBlocks.length, 0, 'no address blocks');

const mixed = parseSvd(
    '<device><name>Mixed</name><peripherals><peripheral><name>P</name><baseAddress>0x0</baseAddress><registers><register><name>R%s</name><dim>4</dim><dimIncrement>4</dimIncrement><dimIndex>0-1, 4-5</dimIndex><addressOffset>0x0</addressOffset></register></registers></peripheral></peripherals></device>',
);
assertEqual(
    mixed.peripherals[0].registers.map(register => register.name).join(','),
    'R0,R1,R4,R5',
    'mixed dimIndex values',
);
assertEqual(
    mixed.peripherals[0].registers.map(register => register.address).join(','),
    '0,4,8,12',
    'mixed dimIndex addresses',
);

assertParseError(
    () => parseSvd('<device><name>NoPeripherals</name></device>'),
    'missing peripherals',
);
assertParseError(
    () => parseSvd('<device><name>Broken</name><peripherals><peripheral><name>P</name></peripheral>'),
    'malformed XML',
);
assertParseError(
    () =>
        parseSvd(
            '<device><name>X</name><peripherals><peripheral><name>P</name><baseAddress>0x0</baseAddress><registers><register><name>R</name></register></registers></peripheral></peripherals></device>',
        ),
    'register without addressOffset',
);
assertParseError(
    () =>
        parseSvd(
            '<device><name>X</name><peripherals><peripheral><name>P</name><baseAddress>0x0</baseAddress><registers><register><name>R</name><dim>2</dim><dimIncrement>4</dimIncrement><addressOffset>0x0</addressOffset></register></registers></peripheral></peripherals></device>',
        ),
    'dim register without %s',
);
assertParseError(
    () =>
        parseSvd(
            '<device><name>X</name><peripherals><peripheral><name>P</name><baseAddress>0x0</baseAddress><registers><register><name>R%s</name><dim>2</dim><dimIncrement>4</dimIncrement><dimIndex>0-3</dimIndex><addressOffset>0x0</addressOffset></register></registers></peripheral></peripherals></device>',
        ),
    'dimIndex count mismatch',
);
assertParseError(
    () =>
        parseSvd(
            '<device><name>X</name><peripherals><peripheral><name>P</name><baseAddress>0xZZ</baseAddress></peripheral></peripherals></device>',
        ),
    'invalid number',
);
assertParseError(
    () =>
        parseSvd(
            '<device><name>X</name><peripherals><peripheral><name>P</name><baseAddress>0x0</baseAddress><registers><register><name>R</name><addressOffset>0x0</addressOffset><fields><field><name>F</name></field></fields></register></registers></peripheral></peripherals></device>',
        ),
    'field without bit range',
);
assertParseError(
    () =>
        parseSvd(
            '<device><name>X</name><peripherals><peripheral><name>P</name><baseAddress>0x0</baseAddress><registers><register><name>R</name><addressOffset>0x0</addressOffset><fields><field><name>F</name><bitRange>[3:4]</bitRange></field></fields></register></registers></peripheral></peripherals></device>',
        ),
    'invalid bitRange',
);
assertParseError(
    () =>
        new SvdModel({
            name: 'Dup',
            addressUnitBits: 8,
            width: 32,
            peripherals: [
                { name: 'P', baseAddress: 0, addressBlocks: [], registers: [] },
                { name: 'P', baseAddress: 4, addressBlocks: [], registers: [] },
            ],
        }),
    'duplicate peripheral name',
);

console.log('debug-svd tests passed');
