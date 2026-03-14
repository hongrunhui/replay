cmake_minimum_required(VERSION 3.16)
project(openreplay VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# --- Platform detection ---
if(APPLE)
  set(OPENREPLAY_PLATFORM "macos")
  set(OPENREPLAY_LIB_NAME "libopenreplay.dylib")
elseif(UNIX)
  set(OPENREPLAY_PLATFORM "linux")
  set(OPENREPLAY_LIB_NAME "libopenreplay.so")
endif()

message(STATUS "Building Open Replay driver for ${OPENREPLAY_PLATFORM}")

# --- Source files ---
set(DRIVER_SOURCES
  src/driver.cc
  src/format/recording.cc
  src/checkpoint/checkpoint.cc
  src/intercept/time.cc
  src/intercept/random.cc
  src/intercept/fs.cc
  src/intercept/net.cc
  src/intercept/thread.cc
)

# --- Shared library ---
add_library(openreplay SHARED ${DRIVER_SOURCES})

target_include_directories(openreplay PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_compile_options(openreplay PRIVATE
  -Wall -Wextra -Wno-unused-parameter
)

if(APPLE)
  target_link_libraries(openreplay PRIVATE dl)
  # Ensure DYLD_INTERPOSE sections are preserved
  set_target_properties(openreplay PROPERTIES
    INSTALL_RPATH "@rpath"
    BUILD_WITH_INSTALL_RPATH TRUE
  )
elseif(UNIX)
  target_link_libraries(openreplay PRIVATE dl pthread)
endif()

# --- Test executable ---
add_executable(test_driver tests/test_driver.cc)
target_include_directories(test_driver PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)
target_link_libraries(test_driver PRIVATE openreplay)

# --- Install ---
install(TARGETS openreplay
  LIBRARY DESTINATION lib
  ARCHIVE DESTINATION lib
)
install(FILES src/driver.h DESTINATION include/openreplay)
