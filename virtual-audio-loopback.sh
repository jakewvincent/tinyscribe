#!/bin/bash
#
# Virtual Audio Loopback Toggle
# Creates a virtual microphone that captures system audio output
# Audio still plays through your speakers normally
#
# Usage:
#   ./virtual-audio-loopback.sh on    # Enable virtual mic
#   ./virtual-audio-loopback.sh off   # Disable virtual mic
#   ./virtual-audio-loopback.sh       # Toggle (or show status)
#

SINK_NAME="VirtualMic"
SINK_DESC="Virtual_Microphone_Loopback"

is_running() {
    pactl list short modules 2>/dev/null | grep -q "module-null-sink.*$SINK_NAME"
}

start_loopback() {
    if is_running; then
        echo "Virtual audio loopback is already running."
        return 0
    fi

    echo "Starting virtual audio loopback..."

    # Create a virtual sink (null sink)
    pactl load-module module-null-sink \
        sink_name="$SINK_NAME" \
        sink_properties=device.description="$SINK_DESC" > /dev/null

    if [ $? -ne 0 ]; then
        echo "Error: Failed to create virtual sink"
        return 1
    fi

    # Create loopback: copies default output monitor -> virtual sink
    # This means: whatever plays through speakers also goes to virtual mic
    # Your speakers still work normally (we're tapping the monitor, not redirecting)
    pactl load-module module-loopback \
        source=@DEFAULT_MONITOR@ \
        sink="$SINK_NAME" \
        latency_msec=10 > /dev/null

    if [ $? -ne 0 ]; then
        echo "Error: Failed to create loopback"
        stop_loopback
        return 1
    fi

    echo "Virtual audio loopback started!"
    echo ""
    echo "In your browser, select this as your microphone:"
    echo "  -> 'Monitor of $SINK_DESC'"
    echo ""
    echo "Audio will continue playing through your speakers normally."
}

stop_loopback() {
    if ! is_running; then
        echo "Virtual audio loopback is not running."
        return 0
    fi

    echo "Stopping virtual audio loopback..."

    # Unload in reverse order
    pactl unload-module module-loopback 2>/dev/null
    pactl unload-module module-null-sink 2>/dev/null

    echo "Virtual audio loopback stopped."
}

show_status() {
    if is_running; then
        echo "Status: RUNNING"
        echo ""
        echo "Virtual sink:"
        pactl list short sinks | grep "$SINK_NAME"
        echo ""
        echo "Available as input: 'Monitor of $SINK_DESC'"
    else
        echo "Status: STOPPED"
        echo ""
        echo "Run './virtual-audio-loopback.sh on' to start"
    fi
}

case "${1:-status}" in
    on|start)
        start_loopback
        ;;
    off|stop)
        stop_loopback
        ;;
    toggle)
        if is_running; then
            stop_loopback
        else
            start_loopback
        fi
        ;;
    status|*)
        show_status
        ;;
esac
