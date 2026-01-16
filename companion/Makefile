# Build the Swift helper for PowerPoint video timing
# Targets: Intel (x86_64) and Apple Silicon (arm64)

HELPER_SRC = ppt-probe/ppt-probe-mac.swift
HELPER_BIN = bin/ppt-probe-mac

.PHONY: all clean build-universal

all: build-universal

$(HELPER_BIN): $(HELPER_SRC)
	mkdir -p bin
	swiftc -O -arch arm64 -arch x86_64 -o $(HELPER_BIN) $(HELPER_SRC)

build-universal: $(HELPER_BIN)
	@echo "Build successful: $(HELPER_BIN)"
	@file $(HELPER_BIN)

clean:
	rm -f $(HELPER_BIN)
