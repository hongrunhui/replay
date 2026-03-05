#!/usr/bin/env python3
"""
V8 Recording File Analyzer
Analyzes .rec files and displays statistics
"""

import sys
import struct
from collections import defaultdict

class RecordingAnalyzer:
    def __init__(self, filename):
        self.filename = filename
        self.execution_points = []
        self.non_deterministic_data = []

    def read_header(self, f):
        """读取文件头"""
        magic = f.read(8).decode('ascii')
        if magic != 'V8REC001':
            raise ValueError(f"Invalid magic: {magic}")

        version = struct.unpack('I', f.read(4))[0]
        timestamp = struct.unpack('Q', f.read(8))[0]
        flags = struct.unpack('I', f.read(4))[0]
        reserved = struct.unpack('Q', f.read(8))[0]

        return {
            'magic': magic,
            'version': version,
            'timestamp': timestamp,
            'flags': flags
        }

    def read_execution_points(self, f):
        """读取执行点"""
        try:
            count = struct.unpack('I', f.read(4))[0]
        except:
            return False

        for _ in range(count):
            point_id = struct.unpack('Q', f.read(8))[0]
            timestamp = struct.unpack('Q', f.read(8))[0]
            bytecode_offset = struct.unpack('i', f.read(4))[0]

            name_len = struct.unpack('I', f.read(4))[0]
            function_name = f.read(name_len).decode('utf-8')

            line_number = struct.unpack('i', f.read(4))[0]
            column_number = struct.unpack('i', f.read(4))[0]
            stack_depth = struct.unpack('I', f.read(4))[0]

            self.execution_points.append({
                'id': point_id,
                'timestamp': timestamp,
                'bytecode_offset': bytecode_offset,
                'function_name': function_name,
                'line_number': line_number,
                'column_number': column_number,
                'stack_depth': stack_depth
            })

        return True

    def read_non_deterministic_data(self, f):
        """读取非确定性数据"""
        try:
            count = struct.unpack('I', f.read(4))[0]
        except:
            return False

        type_names = {0: 'RANDOM', 1: 'TIME', 2: 'IO', 3: 'EXTERNAL'}

        for _ in range(count):
            data_type = struct.unpack('B', f.read(1))[0]
            execution_point_id = struct.unpack('Q', f.read(8))[0]
            data_len = struct.unpack('I', f.read(4))[0]
            data = f.read(data_len)

            self.non_deterministic_data.append({
                'type': type_names.get(data_type, 'UNKNOWN'),
                'execution_point_id': execution_point_id,
                'data_len': data_len,
                'data': data
            })

        return True

    def analyze(self):
        """分析录制文件"""
        with open(self.filename, 'rb') as f:
            # 读取文件头
            header = self.read_header(f)
            print(f"=== Recording File: {self.filename} ===")
            print(f"Magic: {header['magic']}")
            print(f"Version: {header['version']}")
            print(f"Timestamp: {header['timestamp']}")
            print()

            # 读取所有数据块
            while True:
                if not self.read_execution_points(f):
                    break
                if not self.read_non_deterministic_data(f):
                    break

            # 统计信息
            self.print_statistics()

    def print_statistics(self):
        """打印统计信息"""
        print("=== Statistics ===")
        print(f"Total execution points: {len(self.execution_points)}")
        print(f"Non-deterministic data: {len(self.non_deterministic_data)}")
        print()

        # 函数调用统计
        function_counts = defaultdict(int)
        for point in self.execution_points:
            function_counts[point['function_name']] += 1

        print("=== Top 10 Functions ===")
        for func, count in sorted(function_counts.items(), key=lambda x: x[1], reverse=True)[:10]:
            print(f"  {func}: {count} calls")
        print()

        # 非确定性数据统计
        nd_type_counts = defaultdict(int)
        for data in self.non_deterministic_data:
            nd_type_counts[data['type']] += 1

        print("=== Non-Deterministic Data ===")
        for data_type, count in nd_type_counts.items():
            print(f"  {data_type}: {count}")
        print()

        # 调用栈深度统计
        max_depth = max((p['stack_depth'] for p in self.execution_points), default=0)
        print(f"=== Call Stack ===")
        print(f"Maximum depth: {max_depth}")
        print()

        # 时间跨度
        if self.execution_points:
            first_ts = self.execution_points[0]['timestamp']
            last_ts = self.execution_points[-1]['timestamp']
            duration_us = last_ts - first_ts
            duration_ms = duration_us / 1000.0
            print(f"=== Execution Time ===")
            print(f"Duration: {duration_ms:.2f} ms ({duration_us} μs)")
            print()

    def print_execution_trace(self, limit=20):
        """打印执行轨迹"""
        print(f"=== Execution Trace (first {limit} points) ===")
        for i, point in enumerate(self.execution_points[:limit]):
            indent = "  " * point['stack_depth']
            print(f"[{point['id']:4d}] {indent}{point['function_name']} "
                  f"at {point['line_number']}:{point['column_number']}")

        if len(self.execution_points) > limit:
            print(f"... and {len(self.execution_points) - limit} more points")
        print()

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 analyze.py <recording-file> [--trace]")
        print("Example: python3 analyze.py fibonacci.rec")
        sys.exit(1)

    filename = sys.argv[1]
    show_trace = '--trace' in sys.argv

    try:
        analyzer = RecordingAnalyzer(filename)
        analyzer.analyze()

        if show_trace:
            analyzer.print_execution_trace()

    except FileNotFoundError:
        print(f"Error: File not found: {filename}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
