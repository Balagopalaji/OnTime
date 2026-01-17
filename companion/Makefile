# Build the Swift helper for PowerPoint video timing
HELPER_SRC = ppt-probe/ppt-probe-mac.swift
HELPER_BIN = bin/ppt-probe-mac

.PHONY: all clean build

all: build

$(HELPER_BIN): $(HELPER_SRC)
	mkdir -p bin
	swiftc -O -o $(HELPER_BIN) $(HELPER_SRC)

build: $(HELPER_BIN)
	@echo "Build successful: $(HELPER_BIN)"
	@file $(HELPER_BIN)

clean:
	rm -f $(HELPER_BIN)
