// JS glue for i_net.c (kept separate: emscripten.h clashes with doomtype.h).
#include <stdint.h>
#include <emscripten.h>

EM_JS(void, web_net_send, (int player, const uint8_t* ptr, int len), {
    if (Module.netSend) Module.netSend(player, ptr, len);
});
