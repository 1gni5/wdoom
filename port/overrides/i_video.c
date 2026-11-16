// Web (Emscripten) override of i_video.c.
// No X11: the framebuffer is screens[0] (read by JS via doom_framebuffer),
// the palette is kept in web_palette (gamma applied) for doom_palette.
#include <string.h>

#include "doomdef.h"
#include "doomtype.h"
#include "i_system.h"
#include "i_video.h"
#include "v_video.h"

static byte web_palette[256 * 3];
boolean mousemoved = false;

void I_InitGraphics (void)
{
    // screens[0] is allocated by V_Init(); nothing else to set up.
}

void I_ShutdownGraphics (void)
{
}

void I_StartFrame (void)
{
}

void I_StartTic (void)
{
    // Input is delivered by doom_key()/doom_mouse() calling D_PostEvent.
}

void I_UpdateNoBlit (void)
{
}

void I_FinishUpdate (void)
{
}

void I_ReadScreen (byte* scr)
{
    memcpy (scr, screens[0], SCREENWIDTH * SCREENHEIGHT);
}

void I_SetPalette (byte* palette)
{
    int i;
    for (i = 0; i < 256 * 3; i++)
        web_palette[i] = gammatable[usegamma][palette[i]];
}

// Used by i_main.c (doom_palette).
byte* web_get_palette (void)
{
    return web_palette;
}
