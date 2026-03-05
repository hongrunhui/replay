// Copyright 2024 V8 Recorder Project
// Replay example demonstrating playback and debugging

#include <iostream>
#include <memory>
#include "include/libplatform/libplatform.h"
#include "include/v8.h"
#include "src/recorder/replayer.h"

void PrintExecutionPoint(const v8::internal::ExecutionPoint* point) {
  std::cout << "  [" << point->id << "] "
            << point->function_name
            << " at line " << point->line_number
            << ":" << point->column_number
            << " (depth: " << point->stack_depth << ")"
            << std::endl;
}

int main(int argc, char* argv[]) {
  if (argc < 2) {
    std::cerr << "Usage: " << argv[0] << " <recording-file>" << std::endl;
    std::cerr << "Example: " << argv[0] << " fibonacci.rec" << std::endl;
    return 1;
  }

  const char* recording_file = argv[1];

  // 创建重放器
  v8::internal::Replayer replayer;

  // 加载录制文件
  std::cout << "Loading recording from: " << recording_file << std::endl;
  if (!replayer.Load(recording_file)) {
    std::cerr << "Failed to load recording" << std::endl;
    return 1;
  }

  std::cout << "\n=== Replay Options ===" << std::endl;
  std::cout << "1. Full replay" << std::endl;
  std::cout << "2. Step-by-step replay" << std::endl;
  std::cout << "3. Replay with breakpoint" << std::endl;
  std::cout << "Enter option (1-3): ";

  int option;
  std::cin >> option;

  switch (option) {
    case 1: {
      // 完整重放
      std::cout << "\n=== Full Replay ===" << std::endl;
      replayer.StartReplay();

      int count = 0;
      while (const auto* point = replayer.GetNextExecutionPoint()) {
        if (count < 10 || count % 100 == 0) {
          PrintExecutionPoint(point);
        }
        count++;
      }

      std::cout << "\nTotal execution points: " << count << std::endl;
      break;
    }

    case 2: {
      // 单步重放
      std::cout << "\n=== Step-by-Step Replay ===" << std::endl;
      std::cout << "Press Enter to step, 'q' to quit" << std::endl;

      replayer.StartReplay();

      std::string input;
      while (true) {
        std::getline(std::cin, input);
        if (input == "q") break;

        const auto* point = replayer.GetNextExecutionPoint();
        if (!point) {
          std::cout << "End of recording" << std::endl;
          break;
        }

        PrintExecutionPoint(point);

        // 检查非确定性数据
        double random_value;
        if (replayer.GetRandomValue(point->id, &random_value)) {
          std::cout << "    Random value: " << random_value << std::endl;
        }

        double time_value;
        if (replayer.GetTimeValue(point->id, &time_value)) {
          std::cout << "    Time value: " << time_value << std::endl;
        }
      }
      break;
    }

    case 3: {
      // 带断点的重放
      std::cout << "\n=== Replay with Breakpoint ===" << std::endl;
      std::cout << "Enter breakpoint execution point ID: ";

      uint64_t breakpoint_id;
      std::cin >> breakpoint_id;

      replayer.SetBreakpoint(breakpoint_id);
      replayer.StartReplay();

      std::cout << "Running until breakpoint..." << std::endl;

      int count = 0;
      while (const auto* point = replayer.GetNextExecutionPoint()) {
        count++;
        if (!replayer.IsReplaying()) {
          std::cout << "\nBreakpoint hit!" << std::endl;
          PrintExecutionPoint(point);
          break;
        }
      }

      std::cout << "Executed " << count << " points before breakpoint" << std::endl;
      break;
    }

    default:
      std::cerr << "Invalid option" << std::endl;
      return 1;
  }

  std::cout << "\n=== Replay Statistics ===" << std::endl;
  std::cout << "Total execution points: " << replayer.GetTotalExecutionPoints() << std::endl;
  std::cout << "Current position: " << replayer.GetCurrentPosition() << std::endl;

  return 0;
}
