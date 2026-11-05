#include <cuda_runtime.h>

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <regex>
#include <string>
#include <vector>

namespace fs = std::filesystem;
constexpr int kCanvas = 16384;
constexpr int kTile = 4096;
constexpr size_t kTileBytes = static_cast<size_t>(kTile) * kTile * 4;

static bool has(const std::string& text, const std::string& key) {
  return text.find(key) != std::string::npos;
}

static std::string value(const std::string& text, const std::string& key) {
  const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"");
  std::smatch match;
  if (std::regex_search(text, match, pattern)) return match[1].str();
  return {};
}

static std::string shellQuote(const std::string& input) {
  std::string result = "'";
  for (const char c : input) result += c == '\'' ? std::string("'\\''") : std::string(1, c);
  return result + "'";
}

static std::string formatTilePath(const std::string& pattern, int frame, int column, int row) {
  const int values[] = {frame, column, row};
  int index = 0;
  std::string result;
  std::regex token("%0?(\\d*)d");
  std::string::const_iterator searchStart(pattern.cbegin());
  std::smatch match;
  while (std::regex_search(searchStart, pattern.cend(), match, token)) {
    result.append(searchStart, match[0].first);
    int width = match[1].str().empty() ? 0 : std::stoi(match[1].str());
    std::string number = std::to_string(values[index < 3 ? index : 2]);
    if (width > 0 && static_cast<int>(number.size()) < width) number.insert(0, width - number.size(), '0');
    result += number;
    index += 1;
    searchStart = match[0].second;
  }
  result.append(searchStart, pattern.cend());
  return result;
}

static bool readPngAsRgba(const fs::path& file, std::vector<unsigned char>& output) {
  const std::string command = "ffmpeg -hide_banner -loglevel error -i " + shellQuote(file.string()) +
    " -frames:v 1 -f rawvideo -pix_fmt rgba -";
  FILE* pipe = popen(command.c_str(), "r");
  if (!pipe) return false;
  output.resize(kTileBytes);
  size_t offset = 0;
  while (offset < output.size()) {
    const size_t count = fread(output.data() + offset, 1, output.size() - offset, pipe);
    if (count == 0) break;
    offset += count;
  }
  const int code = pclose(pipe);
  return code == 0 && offset == output.size();
}

__global__ void copyTile(const unsigned char* tile, unsigned char* canvas, int column, int row) {
  const int x = blockIdx.x * blockDim.x + threadIdx.x;
  const int y = blockIdx.y * blockDim.y + threadIdx.y;
  if (x >= kTile || y >= kTile) return;
  const size_t source = (static_cast<size_t>(y) * kTile + x) * 4;
  const size_t target = (static_cast<size_t>(row * kTile + y) * kCanvas + column * kTile + x) * 4;
  canvas[target] = tile[source];
  canvas[target + 1] = tile[source + 1];
  canvas[target + 2] = tile[source + 2];
  canvas[target + 3] = tile[source + 3];
}

static void emit(const std::string& json) {
  std::cout << json << std::endl;
}

int main() {
  std::ios::sync_with_stdio(false);
  std::string line;
  while (std::getline(std::cin, line)) {
    if (!has(line, "\"type\"")) continue;
    if (!has(line, "\"type\":\"start\"")) continue;

    const std::string session = value(line, "sessionId");
    const fs::path manifestPath = value(line, "manifest");
    std::ifstream manifestFile(manifestPath);
    const std::string manifest((std::istreambuf_iterator<char>(manifestFile)), std::istreambuf_iterator<char>());
    const std::string pattern = value(manifest, "pattern");
    if (pattern.empty()) {
      emit("{\"type\":\"error\",\"code\":\"tile_manifest_invalid\",\"message\":\"manifest pattern is missing\"}");
      return 3;
    }

    int deviceCount = 0;
    cudaError_t error = cudaGetDeviceCount(&deviceCount);
    if (error != cudaSuccess || deviceCount < 1) {
      emit("{\"type\":\"error\",\"code\":\"cuda_device_unavailable\",\"message\":\"CUDA device is unavailable\"}");
      return 2;
    }

    unsigned char* canvas = nullptr;
    unsigned char* tile = nullptr;
    if (cudaMalloc(reinterpret_cast<void**>(&canvas), static_cast<size_t>(kCanvas) * kCanvas * 4) != cudaSuccess ||
        cudaMalloc(reinterpret_cast<void**>(&tile), kTileBytes) != cudaSuccess) {
      emit("{\"type\":\"error\",\"code\":\"cuda_allocation_failed\",\"message\":\"could not allocate 16K GPU framebuffer\"}");
      if (canvas) cudaFree(canvas);
      if (tile) cudaFree(tile);
      return 4;
    }
    cudaMemset(canvas, 0, static_cast<size_t>(kCanvas) * kCanvas * 4);
    std::vector<unsigned char> rgba;
    const dim3 block(16, 16);
    const dim3 grid((kTile + block.x - 1) / block.x, (kTile + block.y - 1) / block.y);
    for (int row = 0; row < 4; row += 1) {
      for (int column = 0; column < 4; column += 1) {
        const fs::path tilePath = manifestPath.parent_path() / formatTilePath(pattern, 0, column, row);
        if (!readPngAsRgba(tilePath, rgba)) {
          emit("{\"type\":\"error\",\"code\":\"tile_decode_failed\",\"message\":\"FFmpeg could not decode a 4096x4096 PNG tile\"}");
          cudaFree(tile); cudaFree(canvas); return 5;
        }
        cudaMemcpy(tile, rgba.data(), kTileBytes, cudaMemcpyHostToDevice);
        copyTile<<<grid, block>>>(tile, canvas, column, row);
      }
    }
    error = cudaDeviceSynchronize();
    cudaFree(tile); cudaFree(canvas);
    if (error != cudaSuccess) {
      emit("{\"type\":\"error\",\"code\":\"cuda_composite_failed\",\"message\":\"CUDA tile composition failed\"}");
      return 6;
    }
    emit("{\"type\":\"ready\",\"sessionId\":\"" + session + "\",\"mode\":\"native-tile\",\"canvasWidth\":16384,\"canvasHeight\":16384,\"tileWidth\":4096,\"tileHeight\":4096,\"columns\":4,\"rows\":4,\"gpu\":true}");
    emit("{\"type\":\"composite\",\"frame\":0,\"gpu\":true,\"canvasWidth\":16384,\"canvasHeight\":16384}");
  }
  return 0;
}
