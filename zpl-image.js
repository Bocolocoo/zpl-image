(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    // generic browser usage
    let ex = factory();
    for (let id in ex) {
      root[id] = ex[id];
    }
  }
})(typeof self !== "undefined" ? self : this, function () {
  const zlib =
    typeof process == "object" &&
    typeof process.release == "object" &&
    process.release.name == "node"
      ? require("react-zlib-js")
      : null;

  const pako = require("pako");

  // DOM-specialized version for browsers.
  function imageToZ64(img, opts) {
    // Draw the image to a temp canvas so we can access its RGBA data
    let cvs = document.createElement("canvas");
    let ctx = cvs.getContext("2d");

    cvs.width = +img.width || img.offsetWidth;
    cvs.height = +img.height || img.offsetHeight;
    ctx.drawImage(img, 0, 0);

    let pixels = ctx.getImageData(0, 0, cvs.width, cvs.height);
    return rgbaToZ64(pixels.data, pixels.width, opts);
  }

  // Uses zlib on node.js, pako.js in the browser.
  //
  // `rgba` can be a Uint8Array or Buffer, or an Array of integers between 0 and 255.
  // `width` is the image width, in pixels
  // `opts` is an options object:
  //		`black` is the blackness percent between 1..99, default 50.
  //		`rotate` is one of:
  //			'N' no rotation (default)
  //			'L' rotate 90 degrees counter-clockwise
  //			'R' rotate 90 degrees clockwise
  //			'I' rotate 180 degrees (inverted)
  //			'B' same as 'L'
  function rgbaToZ64(rgba, width, opts) {
    opts = opts || {};
    width = width | 0;
    if (!width || width < 0) {
      throw new Error("Invalid width");
    }
    let height = ~~(rgba.length / width / 4);

    // Create a monochome image, cropped to remove padding.
    // The return is a Uint8Array with extra properties width and height.
    let mono = monochrome(rgba, width, height, +opts.black || 50, opts.notrim);

    let buf;
    switch (opts.rotate) {
      case "R":
        buf = right(mono);
        break;
      case "B":
      case "L":
        buf = left(mono);
        break;
      case "I":
        buf = invert(mono);
        break;
      default:
        buf = normal(mono);
        break;
    }

    // Compress and base64 encode
    let imgw = buf.width;
    let imgh = buf.height;
    let rowl = ~~((imgw + 7) / 8);
    let b64;
    if (zlib) {
      b64 = zlib.deflateSync(buf).toString("base64");
    } else {
      b64 = pako.deflate(buf);
    }
    test = buf;

    // Example usage of the return value `rv`:
    //		'^GFA,' + rv.length + ',' + rv.length + ',' + rv.rowlen + ',' + rv.z64
    return {
      length: buf.length, // uncompressed number of bytes
      rowlen: rowl, // number of packed bytes per row
      width: imgw, // rotated image width in pixels
      height: imgh, // rotated image height in pixels
      z64: b64,
      test: test,
    };
  }

  // Normal, unrotated case
  function normal(mono) {
    let width = mono.width;
    let height = mono.height;

    let buf = new Uint8Array(~~((width + 7) / 8) * height);
    let idx = 0; // index into buf
    let byte = 0; // current byte of image data
    let bitx = 0; // bit index
    for (let i = 0, n = mono.length; i < n; i++) {
      byte |= mono[i] << (7 - (bitx++ & 7));

      if (bitx == width || !(bitx & 7)) {
        buf[idx++] = byte;
        byte = 0;
        if (bitx == width) {
          bitx = 0;
        }
      }
    }
    buf.width = width;
    buf.height = height;
    return buf;
  }

  // Inverted 180 degrees
  function invert(mono) {
    let width = mono.width;
    let height = mono.height;

    let buf = new Uint8Array(~~((width + 7) / 8) * height);
    let idx = 0; // index into buf
    let byte = 0; // current byte of image data
    let bitx = 0; // bit index
    for (let i = mono.length - 1; i >= 0; i--) {
      byte |= mono[i] << (7 - (bitx++ & 7));

      if (bitx == width || !(bitx & 7)) {
        buf[idx++] = byte;
        byte = 0;
        if (bitx == width) {
          bitx = 0;
        }
      }
    }
    buf.width = width;
    buf.height = height;
    return buf;
  }

  // Rotate 90 degrees counter-clockwise
  function left(mono) {
    let width = mono.width;
    let height = mono.height;

    let buf = new Uint8Array(~~((height + 7) / 8) * width);
    let idx = 0; // index into buf
    let byte = 0; // current byte of image data
    for (let x = width - 1; x >= 0; x--) {
      let bitx = 0; // bit index
      for (let y = 0; y < height; y++) {
        byte |= mono[y * width + x] << (7 - (bitx++ & 7));

        if (y == height - 1 || !(bitx & 7)) {
          buf[idx++] = byte;
          byte = 0;
        }
      }
    }
    buf.width = height;
    buf.height = width;
    return buf;
  }

  // Rotate 90 degrees clockwise
  function right(mono) {
    let width = mono.width;
    let height = mono.height;

    let buf = new Uint8Array(~~((height + 7) / 8) * width);
    let idx = 0; // index into buf
    let byte = 0; // current byte of image data
    for (let x = 0; x < width; x++) {
      let bitx = 0; // bit index
      for (let y = height - 1; y >= 0; y--) {
        byte |= mono[y * width + x] << (7 - (bitx++ & 7));

        if (y == 0 || !(bitx & 7)) {
          buf[idx++] = byte;
          byte = 0;
        }
      }
    }
    buf.width = height;
    buf.height = width;
    return buf;
  }

  // Convert the RGBA to monochrome, 1-bit-per-byte.  Crops
  // empty space around the edges of the image if !notrim.
  function monochrome(rgba, width, height, black, notrim) {
    // Convert black from percent to 0..255 value
    black = (255 * black) / 100;

    let minx, maxx, miny, maxy;
    if (notrim) {
      minx = miny = 0;
      maxx = width - 1;
      maxy = height - 1;
    } else {
      // Run through the image and determine bounding box
      maxx = maxy = 0;
      minx = width;
      miny = height;
      let x = 0,
        y = 0;
      for (let i = 0, n = width * height * 4; i < n; i += 4) {
        // Alpha blend with white.
        let a = rgba[i + 3] / 255;
        let r = rgba[i] * 0.3 * a + 255 * (1 - a);
        let g = rgba[i + 1] * 0.59 * a + 255 * (1 - a);
        let b = rgba[i + 2] * 0.11 * a + 255 * (1 - a);
        let gray = r + g + b;

        if (gray <= black) {
          if (minx > x) minx = x;
          if (miny > y) miny = y;
          if (maxx < x) maxx = x;
          if (maxy < y) maxy = y;
        }
        if (++x == width) {
          x = 0;
          y++;
        }
      }
    }

    // One more time through the data, this time we create the cropped image.
    let cx = maxx - minx + 1;
    let cy = maxy - miny + 1;
    let buf = new Uint8Array(cx * cy);
    let idx = 0;
    for (y = miny; y <= maxy; y++) {
      let i = (y * width + minx) * 4;
      for (x = minx; x <= maxx; x++) {
        // Alpha blend with white.
        let a = rgba[i + 3] / 255;
        let r = rgba[i] * 0.3 * a + 255 * (1 - a);
        let g = rgba[i + 1] * 0.59 * a + 255 * (1 - a);
        let b = rgba[i + 2] * 0.11 * a + 255 * (1 - a);
        let gray = r + g + b;

        buf[idx++] = gray <= black ? 1 : 0;
        i += 4;
      }
    }

    // Return the monochrome image
    buf.width = cx;
    buf.height = cy;
    return buf;
  }

  // Cannot use btoa() with Uint8Arrays.  Used only by the browser.
  function u8tob64(a) {
    let s = "";
    let i = 0;
    for (let l = a.length & 0xfffffff0; i < l; i += 16) {
      s += String.fromCharCode(
        a[i],
        a[i + 1],
        a[i + 2],
        a[i + 3],
        a[i + 4],
        a[i + 5],
        a[i + 6],
        a[i + 7],
        a[i + 8],
        a[i + 9],
        a[i + 10],
        a[i + 11],
        a[i + 12],
        a[i + 13],
        a[i + 14],
        a[i + 15]
      );
    }
    while (i < a.length) {
      s += String.fromCharCode(a[i++]);
    }
    return s.toString("base64");
  }

  // CRC16 used by zebra
  const crcTable = [
    0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7, 0x8108,
    0x9129, 0xa14a, 0xb16b, 0xc18c, 0xd1ad, 0xe1ce, 0xf1ef, 0x1231, 0x0210,
    0x3273, 0x2252, 0x52b5, 0x4294, 0x72f7, 0x62d6, 0x9339, 0x8318, 0xb37b,
    0xa35a, 0xd3bd, 0xc39c, 0xf3ff, 0xe3de, 0x2462, 0x3443, 0x0420, 0x1401,
    0x64e6, 0x74c7, 0x44a4, 0x5485, 0xa56a, 0xb54b, 0x8528, 0x9509, 0xe5ee,
    0xf5cf, 0xc5ac, 0xd58d, 0x3653, 0x2672, 0x1611, 0x0630, 0x76d7, 0x66f6,
    0x5695, 0x46b4, 0xb75b, 0xa77a, 0x9719, 0x8738, 0xf7df, 0xe7fe, 0xd79d,
    0xc7bc, 0x48c4, 0x58e5, 0x6886, 0x78a7, 0x0840, 0x1861, 0x2802, 0x3823,
    0xc9cc, 0xd9ed, 0xe98e, 0xf9af, 0x8948, 0x9969, 0xa90a, 0xb92b, 0x5af5,
    0x4ad4, 0x7ab7, 0x6a96, 0x1a71, 0x0a50, 0x3a33, 0x2a12, 0xdbfd, 0xcbdc,
    0xfbbf, 0xeb9e, 0x9b79, 0x8b58, 0xbb3b, 0xab1a, 0x6ca6, 0x7c87, 0x4ce4,
    0x5cc5, 0x2c22, 0x3c03, 0x0c60, 0x1c41, 0xedae, 0xfd8f, 0xcdec, 0xddcd,
    0xad2a, 0xbd0b, 0x8d68, 0x9d49, 0x7e97, 0x6eb6, 0x5ed5, 0x4ef4, 0x3e13,
    0x2e32, 0x1e51, 0x0e70, 0xff9f, 0xefbe, 0xdfdd, 0xcffc, 0xbf1b, 0xaf3a,
    0x9f59, 0x8f78, 0x9188, 0x81a9, 0xb1ca, 0xa1eb, 0xd10c, 0xc12d, 0xf14e,
    0xe16f, 0x1080, 0x00a1, 0x30c2, 0x20e3, 0x5004, 0x4025, 0x7046, 0x6067,
    0x83b9, 0x9398, 0xa3fb, 0xb3da, 0xc33d, 0xd31c, 0xe37f, 0xf35e, 0x02b1,
    0x1290, 0x22f3, 0x32d2, 0x4235, 0x5214, 0x6277, 0x7256, 0xb5ea, 0xa5cb,
    0x95a8, 0x8589, 0xf56e, 0xe54f, 0xd52c, 0xc50d, 0x34e2, 0x24c3, 0x14a0,
    0x0481, 0x7466, 0x6447, 0x5424, 0x4405, 0xa7db, 0xb7fa, 0x8799, 0x97b8,
    0xe75f, 0xf77e, 0xc71d, 0xd73c, 0x26d3, 0x36f2, 0x0691, 0x16b0, 0x6657,
    0x7676, 0x4615, 0x5634, 0xd94c, 0xc96d, 0xf90e, 0xe92f, 0x99c8, 0x89e9,
    0xb98a, 0xa9ab, 0x5844, 0x4865, 0x7806, 0x6827, 0x18c0, 0x08e1, 0x3882,
    0x28a3, 0xcb7d, 0xdb5c, 0xeb3f, 0xfb1e, 0x8bf9, 0x9bd8, 0xabbb, 0xbb9a,
    0x4a75, 0x5a54, 0x6a37, 0x7a16, 0x0af1, 0x1ad0, 0x2ab3, 0x3a92, 0xfd2e,
    0xed0f, 0xdd6c, 0xcd4d, 0xbdaa, 0xad8b, 0x9de8, 0x8dc9, 0x7c26, 0x6c07,
    0x5c64, 0x4c45, 0x3ca2, 0x2c83, 0x1ce0, 0x0cc1, 0xef1f, 0xff3e, 0xcf5d,
    0xdf7c, 0xaf9b, 0xbfba, 0x8fd9, 0x9ff8, 0x6e17, 0x7e36, 0x4e55, 0x5e74,
    0x2e93, 0x3eb2, 0x0ed1, 0x1ef0,
  ];

  function crc16(s) {
    // This is not an accumlating crc routine.  Normally, the acc is intialized to
    // 0xffff then inverted on each call.  We just start with 0.
    let crc = 0;
    let j, i;

    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c > 255) {
        throw new RangeError();
      }
      j = (c ^ (crc >> 8)) & 0xff;
      crc = crcTable[j] ^ (crc << 8);
    }

    crc = (crc & 0xffff).toString(16).toLowerCase();
    return "0000".substr(crc.length) + crc;
  }

  const mapCode = new Map();
  mapCode.set(1, "G");
  mapCode.set(2, "H");
  mapCode.set(3, "I");
  mapCode.set(4, "J");
  mapCode.set(5, "K");
  mapCode.set(6, "L");
  mapCode.set(7, "M");
  mapCode.set(8, "N");
  mapCode.set(9, "O");
  mapCode.set(10, "P");
  mapCode.set(11, "Q");
  mapCode.set(12, "R");
  mapCode.set(13, "S");
  mapCode.set(14, "T");
  mapCode.set(15, "U");
  mapCode.set(16, "V");
  mapCode.set(17, "W");
  mapCode.set(18, "X");
  mapCode.set(19, "Y");
  mapCode.set(20, "g");
  mapCode.set(40, "h");
  mapCode.set(60, "i");
  mapCode.set(80, "j");
  mapCode.set(100, "k");
  mapCode.set(120, "l");
  mapCode.set(140, "m");
  mapCode.set(160, "n");
  mapCode.set(180, "o");
  mapCode.set(200, "p");
  mapCode.set(220, "q");
  mapCode.set(240, "r");
  mapCode.set(260, "s");
  mapCode.set(280, "t");
  mapCode.set(300, "u");
  mapCode.set(320, "v");
  mapCode.set(340, "w");
  mapCode.set(360, "x");
  mapCode.set(380, "y");
  mapCode.set(400, "z");

  function encodeHexAscii(rowlen, code) {
    var maxlinea = rowlen * 2;
    var sbCode = "";
    var sbLinea = "";
    var previousLine = "";
    var counter = 1;
    var aux = code.charAt(0);
    var firstChar = false;
    for (i = 1; i < code.length; i++) {
      if (firstChar) {
        aux = code.charAt(i);
        firstChar = false;
        continue;
      }
      if (
        code.charAt(i) +
          code.charAt(i + 1) +
          code.charAt(i + 2) +
          code.charAt(i + 3) ==
        "0A0D"
      ) {
        if (counter >= maxlinea && aux == "0") {
          sbLinea += ",";
        } else if (counter >= maxlinea && aux == "F") {
          sbLinea += "!";
        } else if (counter > 20) {
          var multi20 = parseInt(counter / 20) * 20;
          var resto20 = counter % 20;
          sbLinea += mapCode.get(multi20);
          if (resto20 != 0) {
            sbLinea += mapCode.get(resto20) + aux;
          } else {
            sbLinea += aux;
          }
        } else {
          sbLinea += mapCode.get(counter) + aux;
          if (mapCode.get(counter) == null) {
          }
        }
        counter = 1;
        firstChar = true;
        if (sbLinea == previousLine) {
          sbCode += ":";
        } else {
          sbCode += sbLinea;
        }
        previousLine = sbLinea;
        sbLinea = "";
        i = i + 3;
        continue;
      }
      if (aux == code.charAt(i)) {
        counter++;
      } else {
        if (counter > 20) {
          var multi20 = parseInt(counter / 20) * 20;
          var resto20 = counter % 20;
          sbLinea += mapCode.get(multi20);
          if (resto20 != 0) {
            sbLinea += mapCode.get(resto20) + aux;
          } else {
            sbLinea += aux;
          }
        } else {
          sbLinea += mapCode.get(counter) + aux;
        }
        counter = 1;
        aux = code.charAt(i);
      }
    }
    return sbCode;
  }

  return zlib ? { rgbaToZ64 } : { rgbaToZ64, imageToZ64, encodeHexAscii };
});
