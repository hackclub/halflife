#!/bin/sh
# Builds the STEP/IGES/BREP to GLB converter the review file viewer uses for models too big for the browser (lib/review-platform/model-conversion.ts). Copied from Fabricate.
# Toolkit names changed in OpenCascade 7.8, so link whichever ones exist.
set -eu

out="${1:-/usr/local/bin/step2glb}"
here="$(dirname "$0")"
include="$(dirname "$(find /usr/include /usr/local/include -name Standard.hxx 2>/dev/null -path '*opencascade*' -print -quit)")"
# `ldconfig -p` answers on glibc systems; musl (Alpine) has no cache, so fall back to the usual directories.
libdir="$(dirname "$(ldconfig -p 2>/dev/null | awk '/libTKernel\.so[^.]/ {print $NF; exit}')")"
for candidate in "$libdir" "/usr/lib/$(gcc -dumpmachine)" /usr/lib /usr/local/lib /usr/lib64; do
  if [ -e "$candidate/libTKernel.so" ]; then libdir="$candidate"; break; fi
done

libs=""
for toolkit in TKernel TKMath TKG2d TKG3d TKGeomBase TKBRep TKGeomAlgo TKTopAlgo TKMesh TKLCAF TKCAF TKXCAF \
  TKRWMesh TKXSBase TKDE TKDESTEP TKDEIGES TKDEGLTF TKSTEP TKSTEPBase TKSTEPAttr TKSTEP209 TKXDESTEP TKIGES TKXDEIGES; do
  if [ -e "$libdir/lib$toolkit.so" ]; then libs="$libs -l$toolkit"; fi
done

# shellcheck disable=SC2086
# STEP2GLB_LDFLAGS lets an image build add an rpath, so the binary can carry its own copy of the libraries it needs.
g++ -O2 -std=c++17 -I"$include" "$here/step2glb.cpp" -o "$out" -L"$libdir" -Wl,--as-needed $libs ${STEP2GLB_LDFLAGS:-}
