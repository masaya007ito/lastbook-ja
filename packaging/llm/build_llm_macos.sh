#!/bin/bash
# Builds lastbook-llm for Apple Silicon: llama.cpp at the pinned tag, Metal, linked into one program with nothing left
# that can open a socket (no RPC backend, no common library beyond the fitting and its log). Run from anywhere:
#   bash packaging/llm/build_llm_macos.sh
# Output: derived/llm/bin-mac/lastbook-llm
set -euo pipefail
HERE="$(dirname "$(/bin/realpath "$0")")"
ROOT="$(dirname "$(dirname "$HERE")")"
TAG=b12032       # the build the small-model evaluation ran on
COMMIT=dde879bc4f954b809892fd0d660515f42536394a
W="$ROOT/derived/llm"
L="$W/llama.cpp"
B="$W/build-mac"
mkdir -p "$W" "$W/bin-mac"
MAP="-ffile-prefix-map=$L=llama.cpp -ffile-prefix-map=$HERE=lastbook-llm"   # no folder of this Mac inside the program
[ -d "$L/.git" ] || git clone -q --depth 1 --branch "$TAG" https://github.com/ggml-org/llama.cpp.git "$L"
[ "$(git -C "$L" rev-parse HEAD)" = "$COMMIT" ] || { echo "llama.cpp is not at $TAG ($COMMIT)" >&2; exit 1; }
cmake -S "$L" -B "$B" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DLLAMA_BUILD_COMMON=OFF -DLLAMA_BUILD_TOOLS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_SERVER=OFF -DLLAMA_CURL=OFF -DLLAMA_OPENSSL=OFF -DGGML_RPC=OFF \
  -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_NATIVE=OFF -DGGML_CCACHE=OFF \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0 -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_C_FLAGS="$MAP" -DCMAKE_CXX_FLAGS="$MAP" -DCMAKE_OBJC_FLAGS="$MAP" > "$W/cmake-mac.log"
cmake --build "$B" -j "$(sysctl -n hw.ncpu)" --target llama vendor-hash > "$W/build-mac.log"   # vendor-hash: linked below, not a dependency of llama
clang++ -std=c++17 -O2 -DNDEBUG $MAP -mmacosx-version-min=14.0 -arch arm64 \
  -I"$L/include" -I"$L/ggml/include" -I"$L/common" -I"$L/vendor" -I"$L/src" \
  "$HERE/lastbook_llm.cpp" "$L/common/fit.cpp" "$L/common/log.cpp" "$L/common/json.cpp" \
  "$B/src/libllama.a" "$B/ggml/src/libggml.a" "$B/ggml/src/ggml-metal/libggml-metal.a" "$B/ggml/src/ggml-blas/libggml-blas.a" \
  "$B/ggml/src/libggml-cpu.a" "$B/ggml/src/libggml-base.a" "$B/vendor/hash/libvendor-hash.a" \
  -framework Metal -framework Foundation -framework MetalKit -framework Accelerate -Wl,-dead_strip \
  -o "$W/bin-mac/lastbook-llm"
strip -x "$W/bin-mac/lastbook-llm"
if strings "$W/bin-mac/lastbook-llm" | grep -q "/Users/"; then echo "lastbook-llm names a folder on this Mac" >&2; exit 1; fi
cp "$L/LICENSE" "$W/bin-mac/LICENSE-llama.cpp.txt"
# Nothing in it may reach a network: no socket calls, no name lookups, no network classes. (NSURL alone is Metal loading a
# file by path: fileURLWithPath.)
if nm -u "$W/bin-mac/lastbook-llm" | grep -E '_(socket|connect|bind|listen|accept|getaddrinfo|gethostbyname|sendto|recvfrom)$|CFNetwork|CFSocket|CFStream|NSURLSession|NSURLConnection|NSStream|_nw_'; then
  echo "lastbook-llm imports network calls" >&2; exit 1
fi
# Web addresses inside are text in llama.cpp's log and error messages (pull requests, papers); with no network calls they go nowhere.
strings "$W/bin-mac/lastbook-llm" | grep -Eio 'https?://[^ "]+' | sort -u > "$W/bin-mac/addresses-in-messages.txt" || true
ls -l "$W/bin-mac/lastbook-llm"
