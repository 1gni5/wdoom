// Web (Emscripten) override of i_net.c: networking disabled,
// single-player doomcom only.
#include <stdlib.h>
#include <string.h>

#include "doomdef.h"
#include "i_system.h"
#include "d_event.h"
#include "d_net.h"
#include "m_argv.h"
#include "doomstat.h"
#include "i_net.h"

int DOOMPORT = 0;

void (*netget) (void);
void (*netsend) (void);

void I_InitNetwork (void)
{
    doomcom = malloc (sizeof (*doomcom));
    memset (doomcom, 0, sizeof (*doomcom));

    doomcom->ticdup = 1;
    doomcom->extratics = 0;
    doomcom->id = DOOMCOM_ID;
    doomcom->numplayers = doomcom->numnodes = 1;
    doomcom->deathmatch = false;
    doomcom->consoleplayer = 0;

    netgame = false;
}

void I_NetCmd (void)
{
    // Only reached for remote nodes, which never exist here.
}
