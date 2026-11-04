#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <regex>
#include <string>

namespace fs = std::filesystem;

static bool has(const std::string& text, const std::string& key) {
  return text.find(key) != std::string::npos;
}

static std::string value(const std::string& text, const std::string& key) {
  const std::regex pattern("\\\"" + key + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"");
  std::smatch match;
  if (std::regex_search(text, match, pattern)) return match[1].str();
  return {};
}

static bool gpu_available() {
  return std::system("nvidia-smi -L >/dev/null 2>&1") == 0;
}

static void emit(const std::string& json) {
  std::cout << json << std::endl;
}

int main() {
  std::ios::sync_with_stdio(false);
  std::string line;
  while (std::getline(std::cin, line)) {
    if (!has(line, "\"type\"")) continue;

    if (has(line, "\"type\":\"start\"")) {
      const std::string session = value(line, "sessionId");
      const std::string manifest = value(line, "manifest");
      const bool gpu = gpu_available();
      const bool manifestExists = !manifest.empty() && fs::is_regular_file(manifest);

      if (!gpu) {
        emit("{\"type\":\"error\",\"code\":\"nvidia_gpu_unavailable\",\"message\":\"nvidia-smi could not access a GPU\"}");
        return 2;
      }
      if (!manifestExists) {
        emit("{\"type\":\"error\",\"code\":\"tile_manifest_unavailable\",\"message\":\"tile manifest does not exist\"}");
        return 3;
      }

      emit("{\"type\":\"ready\",\"sessionId\":\"" + session + "\",\"mode\":\"native-tile\",\"canvasWidth\":16384,\"canvasHeight\":16384,\"tileWidth\":4096,\"tileHeight\":4096,\"columns\":4,\"rows\":4,\"gpu\":true}");
      continue;
    }

    if (has(line, "\"type\":\"signal\"")) {
      emit("{\"type\":\"error\",\"code\":\"webrtc_transport_pending\",\"message\":\"Native tile renderer is ready; WebRTC tile transport is not wired yet\"}");
      continue;
    }
  }
  return 0;
}
