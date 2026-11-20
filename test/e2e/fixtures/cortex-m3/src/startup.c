#include <stdint.h>

extern uint32_t _estack;
extern uint32_t _sidata;
extern uint32_t _sdata;
extern uint32_t _edata;
extern uint32_t _sbss;
extern uint32_t _ebss;
extern int main(void);

void Reset_Handler(void);

__attribute__((section(".isr_vector"), used))
void (* const g_vectors[])(void) = {
    (void (*)(void))&_estack,
    Reset_Handler,
};

void Reset_Handler(void)
{
    uint32_t *source = &_sidata;
    uint32_t *destination = &_sdata;
    while (destination < &_edata) {
        *destination++ = *source++;
    }
    for (destination = &_sbss; destination < &_ebss;) {
        *destination++ = 0;
    }
    main();
    for (;;) {
    }
}
