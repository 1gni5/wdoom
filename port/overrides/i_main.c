// Web (Emscripten) entry point. Replaces i_main.c.
// Exposes the contract API (see CONTRACT.md) instead of a blocking main().
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "doomdef.h"
#include "d_event.h"
#include "d_main.h"
#include "m_argv.h"
#include "v_video.h"

// Provided by i_video.c
extern byte* web_get_palette (void);

// Provided by d_main.c (DOOM_WEB build)
extern void D_DoomLoopTick (void);

static char* web_argv[] = { "doom", "-iwad", "/doom1.wad", NULL };
static int web_started = 0;

// Starts the game. Returns once the first frame can be ticked.
void doom_init (void)
{
    if (web_started)
        return;
    web_started = 1;
    myargc = 3;
    myargv = web_argv;
    D_DoomMain ();
}

// Runs one game frame (call from requestAnimationFrame).
void doom_tick (void)
{
    if (!web_started)
        return;
    D_DoomLoopTick ();
}

// doomkey: Doom KEY_* code (ASCII lowercase for letters); down: 1 press, 0 release.
void doom_key (int doomkey, int down)
{
    event_t ev;
    if (!web_started)
        return;
    ev.type = down ? ev_keydown : ev_keyup;
    ev.data1 = doomkey;
    ev.data2 = ev.data3 = 0;
    D_PostEvent (&ev);
}

// dx, dy: relative motion; buttons: bitmask 1=left 2=right 4=middle.
void doom_mouse (int dx, int dy, int buttons)
{
    event_t ev;
    if (!web_started)
        return;
    ev.type = ev_mouse;
    ev.data1 = buttons;
    ev.data2 = dx;
    ev.data3 = dy;
    D_PostEvent (&ev);
}

// 320x200 palette indices, row-major.
uint8_t* doom_framebuffer (void)
{
    return (uint8_t*) screens[0];
}

// 256*3 RGB bytes, gamma already applied.
uint8_t* doom_palette (void)
{
    return (uint8_t*) web_get_palette ();
}
