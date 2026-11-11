# Notices for `site/dose-trend/`

The dose-trend page is built from `src/` of the Dose-Trend Analyzer (same author as this repository); this folder is its
output. Three things in it come from elsewhere.

## Arimo (SIL Open Font License 1.1) — `pdf-fonts.json`

`pdf-fonts.json` holds four subsets of Arimo (Arimo-Regular, Arimo-Bold, Arimo-Italic, Arimo-BoldItalic), each cut down to Windows-1252 plus the minus sign, arrows and
Greek letters a figure label can use, stored deflated with their advance widths. The page's PDF export embeds them as
TrueType font programs so the exported figure carries its own fonts (journal preflight asks for embedded TrueType, not
Type 3, and never outlined text). Arimo is metrically compatible with Arial, which the page lays text out with; it was
taken from the npm package `@expo-google-fonts/arimo` 0.4.3 (upstream https://github.com/googlefonts/arimo) and
subset with fontTools by `build_fonts.py` of the source tree. The name table of each subset keeps the copyright and
licence strings. The OFL requires that each copy of the font carry its notice; this is that notice, copied verbatim
from the package:

```text
Copyright 2026 The Arimo Project Authors (https://github.com/googlefonts/arimo)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## BioRender illustration — `panel-a.jpg`

The optional "Trial design, illustration" panel is a draft export (1600 × 742 px) of a figure created in BioRender by
the repository owner; the page credits it as "Created in BioRender" wherever it is used. BioRender content is
licensed to its creator by BioRender, not by this repository: publishing the panel in a journal needs a BioRender
publication licence, and the page says so beside the option. The default panel a is a vector schematic drawn by the
page's own code and needs no licence.

## Canvas helpers adapted from MbappeWU/explorable (MIT) — `app.js`

The drawing helpers at the top of `app.js` (`surface`, `animate`, `drag`, `label`, `polyline`, `roundRect`,
`spreadLabels`, `fmt`) adapt `skills/explorable/template.html` of
https://github.com/MbappeWU/explorable at revision `4a72bfa74af8f912eb93701cac924ab0fb68b969`, Copyright (c) 2026
MbappeWU, MIT; the complete notice is in `site/vendor/explorable/LICENSE`. The adaptation adds a true-size narrow
layout, pointer capture and colour-token redraws; no gallery content or media was copied.

## Everything else

The statistics, figure renderer, PDF writer, text and canvas figures are this repository's own code. The molecule is a
conformer of apricitabine computed with RDKit (BSD-3-Clause; not shipped) from the published SMILES and stored as
coordinates in `app.js`; it is data, not a crystal structure. The adverse-event table is transcribed from Cahn P et al.,
AIDS 2006;20:1261–1268, as the page's source list says.
