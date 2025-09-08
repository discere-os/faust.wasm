/**
 * Faust.wasm Audio Worklet Integration
 * Real-time audio processing with WebAudio API and Audio Worklet
 * Advanced audio processing with Faust DSP
 * 
 * WASM Integration Copyright (c) 2025 Superstruct Ltd, New Zealand
 * Licensed under the same license as the underlying Faust project (LGPL 2.1)
 */

/**
 * Faust Audio Worklet Processor
 * Handles real-time Faust DSP processing in the audio thread
 */
class FaustAudioWorkletProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        
        this.initialized = false;
        this.dspInstance = null;
        this.faustModule = null;
        this.parameterMap = new Map();
        this.audioBuffers = {
            input: null,
            output: null
        };
        
        // Performance monitoring
        this.performanceStats = {
            processedSamples: 0,
            totalProcessingTime: 0,
            maxProcessingTime: 0,
            underruns: 0,
            overruns: 0,
            avgCPULoad: 0
        };
        
        // Audio configuration
        this.audioConfig = {
            sampleRate: sampleRate,
            blockSize: 128,
            inputChannels: 1,
            outputChannels: 2
        };
        
        // Initialize from options
        if (options && options.processorOptions) {
            this.initializeFromOptions(options.processorOptions);
        }
        
        // Setup message handling
        this.port.onmessage = this.handleMessage.bind(this);
        
        // Request initialization
        this.port.postMessage({
            type: 'worklet-ready',
            config: this.audioConfig
        });
    }
    
    /**
     * Initialize processor from constructor options
     */
    initializeFromOptions(options) {
        if (options.dspCode) {
            this.compileDSP(options.dspCode);
        }
        
        if (options.audioConfig) {
            this.audioConfig = { ...this.audioConfig, ...options.audioConfig };
        }
        
        if (options.enablePerformanceMonitoring !== undefined) {
            this.performanceMonitoring = options.enablePerformanceMonitoring;
        }
    }
    
    /**
     * Main audio processing function
     * Called by the audio thread for each audio block
     */
    process(inputs, outputs, parameters) {
        if (!this.initialized || !this.dspInstance) {
            // Fill outputs with silence if not ready
            this.fillWithSilence(outputs);
            return true;
        }
        
        const startTime = currentTime;
        
        try {
            // Get input and output arrays
            const input = inputs[0];
            const output = outputs[0];
            
            // Handle parameter updates
            this.updateParameters(parameters);
            
            // Process audio through Faust DSP
            this.processFaustDSP(input, output);
            
            // Update performance statistics
            if (this.performanceMonitoring) {
                this.updatePerformanceStats(currentTime - startTime);
            }
            
            return true;
            
        } catch (error) {
            console.error('Audio processing error:', error);
            this.fillWithSilence(outputs);
            this.reportError(error);
            return true; // Continue processing
        }
    }
    
    /**
     * Process audio through Faust DSP instance
     */
    processFaustDSP(inputs, outputs) {
        const inputChannels = inputs ? inputs.length : 0;
        const outputChannels = outputs ? outputs.length : 0;
        const blockSize = outputs[0] ? outputs[0].length : 128;
        
        // Handle mono input, stereo output (common case)
        if (inputChannels === 1 && outputChannels === 2) {
            this.processMonoToStereo(inputs[0], outputs[0], outputs[1], blockSize);
        }
        // Handle stereo input, stereo output
        else if (inputChannels === 2 && outputChannels === 2) {
            this.processStereoToStereo(inputs, outputs, blockSize);
        }
        // Handle mono to mono
        else if (inputChannels === 1 && outputChannels === 1) {
            this.processMonoToMono(inputs[0], outputs[0], blockSize);
        }
        // Generic multi-channel processing
        else {
            this.processMultiChannel(inputs, outputs, blockSize);
        }
    }
    
    /**
     * Process mono input to stereo output
     */
    processMonoToStereo(input, outputL, outputR, blockSize) {
        // Prepare input buffer
        if (!this.audioBuffers.input || this.audioBuffers.input.length !== blockSize) {
            this.audioBuffers.input = new Float32Array(blockSize);
        }
        
        // Copy input (or fill with zeros if no input)
        if (input) {
            this.audioBuffers.input.set(input);
        } else {
            this.audioBuffers.input.fill(0);
        }
        
        // Prepare output buffers
        const outputBuffer = new Float32Array(blockSize * 2); // Interleaved stereo
        
        // Process through Faust DSP
        this.dspInstance.process(this.audioBuffers.input, outputBuffer);
        
        // De-interleave output
        for (let i = 0; i < blockSize; i++) {
            outputL[i] = outputBuffer[i * 2];
            outputR[i] = outputBuffer[i * 2 + 1];
        }
    }
    
    /**
     * Process stereo input to stereo output  
     */
    processStereoToStereo(inputs, outputs, blockSize) {
        // Prepare interleaved input buffer
        const interleavedInput = new Float32Array(blockSize * 2);
        
        for (let i = 0; i < blockSize; i++) {
            interleavedInput[i * 2] = inputs[0] ? inputs[0][i] : 0;
            interleavedInput[i * 2 + 1] = inputs[1] ? inputs[1][i] : 0;
        }
        
        // Prepare interleaved output buffer
        const interleavedOutput = new Float32Array(blockSize * 2);
        
        // Process through Faust DSP
        this.dspInstance.process(interleavedInput, interleavedOutput);
        
        // De-interleave output
        for (let i = 0; i < blockSize; i++) {
            if (outputs[0]) outputs[0][i] = interleavedOutput[i * 2];
            if (outputs[1]) outputs[1][i] = interleavedOutput[i * 2 + 1];
        }
    }
    
    /**
     * Process mono input to mono output
     */
    processMonoToMono(input, output, blockSize) {
        // Prepare buffers
        const inputBuffer = new Float32Array(blockSize);
        const outputBuffer = new Float32Array(blockSize);
        
        // Copy input
        if (input) {
            inputBuffer.set(input);
        }
        
        // Process through Faust DSP
        this.dspInstance.process(inputBuffer, outputBuffer);
        
        // Copy output
        if (output) {
            output.set(outputBuffer);
        }
    }
    
    /**
     * Generic multi-channel processing
     */
    processMultiChannel(inputs, outputs, blockSize) {
        const inputChannels = inputs.length;
        const outputChannels = outputs.length;
        const totalInputSamples = inputChannels * blockSize;
        const totalOutputSamples = outputChannels * blockSize;
        
        // Prepare interleaved buffers
        const interleavedInput = new Float32Array(totalInputSamples);
        const interleavedOutput = new Float32Array(totalOutputSamples);
        
        // Interleave input
        for (let ch = 0; ch < inputChannels; ch++) {
            if (inputs[ch]) {
                for (let i = 0; i < blockSize; i++) {
                    interleavedInput[i * inputChannels + ch] = inputs[ch][i];
                }
            }
        }
        
        // Process through Faust DSP
        this.dspInstance.process(interleavedInput, interleavedOutput);
        
        // De-interleave output
        for (let ch = 0; ch < outputChannels; ch++) {
            if (outputs[ch]) {
                for (let i = 0; i < blockSize; i++) {
                    outputs[ch][i] = interleavedOutput[i * outputChannels + ch];
                }
            }
        }
    }
    
    /**
     * Update DSP parameters from AudioWorklet parameter automation
     */
    updateParameters(parameters) {
        for (const [paramName, paramValues] of Object.entries(parameters)) {
            if (this.parameterMap.has(paramName)) {
                const paramIndex = this.parameterMap.get(paramName);
                
                // Handle parameter automation (array of values for each sample)
                if (paramValues.length > 1) {
                    // Use the last value for now (could implement per-sample automation)
                    const value = paramValues[paramValues.length - 1];
                    this.dspInstance.setParameter(paramIndex, value);
                } else if (paramValues.length === 1) {
                    this.dspInstance.setParameter(paramIndex, paramValues[0]);
                }
            }
        }
    }
    
    /**
     * Fill output buffers with silence
     */
    fillWithSilence(outputs) {
        for (const output of outputs) {
            if (output) {
                for (const channel of output) {
                    if (channel) {
                        channel.fill(0);
                    }
                }
            }
        }
    }
    
    /**
     * Update performance statistics
     */
    updatePerformanceStats(processingTime) {
        this.performanceStats.totalProcessingTime += processingTime;
        this.performanceStats.maxProcessingTime = Math.max(
            this.performanceStats.maxProcessingTime, 
            processingTime
        );
        
        const blockDuration = 128 / sampleRate; // Assuming 128 sample blocks
        this.performanceStats.avgCPULoad = 
            (this.performanceStats.totalProcessingTime / this.performanceStats.processedSamples) / 
            blockDuration * 100;
        
        // Check for underruns/overruns
        const maxAllowableTime = blockDuration * 0.8; // 80% of available time
        if (processingTime > maxAllowableTime) {
            this.performanceStats.overruns++;
        }
        
        this.performanceStats.processedSamples += 128;
        
        // Report performance issues
        if (this.performanceStats.overruns > 0 && 
            this.performanceStats.processedSamples % (sampleRate * 5) === 0) { // Every 5 seconds
            this.reportPerformanceIssue();
        }
    }
    
    /**
     * Handle messages from main thread
     */
    handleMessage(event) {
        const { type, data } = event.data;
        
        switch (type) {
            case 'compile-dsp':
                this.compileDSP(data.dspCode);
                break;
                
            case 'set-parameter':
                this.setDSPParameter(data.name, data.value);
                break;
                
            case 'get-parameters':
                this.sendParameterList();
                break;
                
            case 'get-performance-stats':
                this.sendPerformanceStats();
                break;
                
            case 'enable-performance-monitoring':
                this.performanceMonitoring = data.enabled;
                break;
                
            case 'set-audio-config':
                this.updateAudioConfig(data.config);
                break;
                
            default:
                console.warn('Unknown worklet message type:', type);
        }
    }
    
    /**
     * Compile Faust DSP code (placeholder - requires Faust WASM module)
     */
    compileDSP(dspCode) {
        try {
            // This would use the actual Faust WASM compiler
            // For now, create a mock DSP instance
            this.dspInstance = this.createMockDSPInstance(dspCode);
            
            // Extract parameter information
            this.extractParameters();
            
            this.initialized = true;
            
            this.port.postMessage({
                type: 'dsp-compiled',
                success: true,
                parameters: this.getParameterDescriptors()
            });
            
        } catch (error) {
            this.port.postMessage({
                type: 'dsp-compiled',
                success: false,
                error: error.message
            });
        }
    }
    
    /**
     * Create mock DSP instance for testing
     */
    createMockDSPInstance(dspCode) {
        return {
            process: (input, output) => {
                // Simple passthrough with gain for testing
                const gain = 0.5;
                
                if (input.length === output.length) {
                    // Mono processing
                    for (let i = 0; i < input.length; i++) {
                        output[i] = input[i] * gain;
                    }
                } else if (output.length === input.length * 2) {
                    // Mono to stereo
                    for (let i = 0; i < input.length; i++) {
                        output[i * 2] = input[i] * gain;
                        output[i * 2 + 1] = input[i] * gain;
                    }
                }
            },
            
            setParameter: (index, value) => {
                // Mock parameter setting
            },
            
            getParameter: (index) => {
                return 0.5; // Mock parameter value
            }
        };
    }
    
    /**
     * Extract parameter information from DSP instance
     */
    extractParameters() {
        // Mock parameter extraction
        const mockParameters = [
            { name: 'frequency', min: 40, max: 8000, default: 440, index: 0 },
            { name: 'gain', min: 0, max: 1, default: 0.1, index: 1 }
        ];
        
        this.parameterMap.clear();
        mockParameters.forEach(param => {
            this.parameterMap.set(param.name, param.index);
        });
        
        this.parameters = mockParameters;
    }
    
    /**
     * Set DSP parameter by name
     */
    setDSPParameter(name, value) {
        if (this.dspInstance && this.parameterMap.has(name)) {
            const index = this.parameterMap.get(name);
            this.dspInstance.setParameter(index, value);
        }
    }
    
    /**
     * Send parameter list to main thread
     */
    sendParameterList() {
        this.port.postMessage({
            type: 'parameter-list',
            parameters: this.getParameterDescriptors()
        });
    }
    
    /**
     * Send performance statistics to main thread
     */
    sendPerformanceStats() {
        this.port.postMessage({
            type: 'performance-stats',
            stats: { ...this.performanceStats }
        });
    }
    
    /**
     * Get parameter descriptors for AudioWorkletNode
     */
    getParameterDescriptors() {
        return this.parameters || [];
    }
    
    /**
     * Update audio configuration
     */
    updateAudioConfig(config) {
        this.audioConfig = { ...this.audioConfig, ...config };
        
        // Reallocate buffers if necessary
        this.audioBuffers = {
            input: null,
            output: null
        };
    }
    
    /**
     * Report performance issues
     */
    reportPerformanceIssue() {
        this.port.postMessage({
            type: 'performance-warning',
            stats: {
                overruns: this.performanceStats.overruns,
                avgCPULoad: this.performanceStats.avgCPULoad,
                maxProcessingTime: this.performanceStats.maxProcessingTime
            }
        });
    }
    
    /**
     * Report processing errors
     */
    reportError(error) {
        this.port.postMessage({
            type: 'processing-error',
            error: {
                message: error.message,
                stack: error.stack,
                timestamp: currentTime
            }
        });
    }
    
    /**
     * Static method to get processor parameter descriptors
     */
    static get parameterDescriptors() {
        // Return default parameters (will be updated after DSP compilation)
        return [
            {
                name: 'frequency',
                defaultValue: 440,
                minValue: 40,
                maxValue: 8000,
                automationRate: 'a-rate'
            },
            {
                name: 'gain',
                defaultValue: 0.1,
                minValue: 0,
                maxValue: 1,
                automationRate: 'a-rate'
            }
        ];
    }
}

/**
 * Main Thread Faust Audio Worklet Manager
 * Manages worklet lifecycle, parameter automation, and performance monitoring
 */
class FaustAudioWorkletManager {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.workletNode = null;
        this.dspCode = null;
        this.parameters = new Map();
        this.performanceMonitoring = true;
        this.eventListeners = new Map();
        
        // Performance monitoring
        this.performanceInterval = null;
        this.lastPerformanceUpdate = 0;
    }
    
    /**
     * Initialize the audio worklet with Faust processor
     */
    async initialize() {
        try {
            // Register the Faust audio worklet processor
            await this.audioContext.audioWorklet.addModule(
                URL.createObjectURL(
                    new Blob([this.getWorkletProcessorCode()], { type: 'application/javascript' })
                )
            );
            
            console.log('✅ Faust Audio Worklet registered successfully');
            return true;
            
        } catch (error) {
            console.error('❌ Failed to register Faust Audio Worklet:', error);
            throw error;
        }
    }
    
    /**
     * Create worklet node with Faust DSP
     */
    async createWorkletNode(dspCode, options = {}) {
        try {
            // Create the Audio Worklet Node
            this.workletNode = new AudioWorkletNode(this.audioContext, 'faust-processor', {
                processorOptions: {
                    dspCode,
                    audioConfig: {
                        sampleRate: this.audioContext.sampleRate,
                        ...options.audioConfig
                    },
                    enablePerformanceMonitoring: this.performanceMonitoring
                }
            });
            
            // Setup message handling
            this.workletNode.port.onmessage = this.handleWorkletMessage.bind(this);
            
            // Setup parameter automation
            await this.setupParameterAutomation();
            
            // Start performance monitoring if enabled
            if (this.performanceMonitoring) {
                this.startPerformanceMonitoring();
            }
            
            this.dspCode = dspCode;
            
            console.log('✅ Faust Audio Worklet Node created');
            return this.workletNode;
            
        } catch (error) {
            console.error('❌ Failed to create Faust Audio Worklet Node:', error);
            throw error;
        }
    }
    
    /**
     * Compile new DSP code in the worklet
     */
    async compileDSP(dspCode) {
        if (!this.workletNode) {
            throw new Error('Worklet node not created');
        }
        
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('DSP compilation timeout'));
            }, 10000); // 10 second timeout
            
            const handleCompileResponse = (event) => {
                if (event.data.type === 'dsp-compiled') {
                    clearTimeout(timeout);
                    this.workletNode.port.removeEventListener('message', handleCompileResponse);
                    
                    if (event.data.success) {
                        this.dspCode = dspCode;
                        this.updateParameterMap(event.data.parameters);
                        resolve(event.data.parameters);
                    } else {
                        reject(new Error(event.data.error));
                    }
                }
            };
            
            this.workletNode.port.addEventListener('message', handleCompileResponse);
            
            this.workletNode.port.postMessage({
                type: 'compile-dsp',
                data: { dspCode }
            });
        });
    }
    
    /**
     * Set DSP parameter with optional automation
     */
    setParameter(name, value, automationTime = null) {
        if (!this.workletNode) {
            throw new Error('Worklet node not created');
        }
        
        // Use AudioParam for automation if specified
        if (automationTime !== null && this.workletNode.parameters.has(name)) {
            const param = this.workletNode.parameters.get(name);
            param.setValueAtTime(value, automationTime);
        } else {
            // Direct parameter setting
            this.workletNode.port.postMessage({
                type: 'set-parameter',
                data: { name, value }
            });
        }
        
        this.parameters.set(name, value);
    }
    
    /**
     * Get current parameter value
     */
    getParameter(name) {
        if (this.workletNode && this.workletNode.parameters.has(name)) {
            return this.workletNode.parameters.get(name).value;
        }
        return this.parameters.get(name);
    }
    
    /**
     * Get all parameters
     */
    async getParameters() {
        if (!this.workletNode) {
            return [];
        }
        
        return new Promise((resolve) => {
            const handleParametersResponse = (event) => {
                if (event.data.type === 'parameter-list') {
                    this.workletNode.port.removeEventListener('message', handleParametersResponse);
                    resolve(event.data.parameters);
                }
            };
            
            this.workletNode.port.addEventListener('message', handleParametersResponse);
            
            this.workletNode.port.postMessage({
                type: 'get-parameters'
            });
        });
    }
    
    /**
     * Connect worklet to audio graph
     */
    connect(destination) {
        if (!this.workletNode) {
            throw new Error('Worklet node not created');
        }
        
        return this.workletNode.connect(destination);
    }
    
    /**
     * Disconnect worklet from audio graph
     */
    disconnect() {
        if (this.workletNode) {
            this.workletNode.disconnect();
        }
    }
    
    /**
     * Enable/disable performance monitoring
     */
    setPerformanceMonitoring(enabled) {
        this.performanceMonitoring = enabled;
        
        if (this.workletNode) {
            this.workletNode.port.postMessage({
                type: 'enable-performance-monitoring',
                data: { enabled }
            });
        }
        
        if (enabled && !this.performanceInterval) {
            this.startPerformanceMonitoring();
        } else if (!enabled && this.performanceInterval) {
            this.stopPerformanceMonitoring();
        }
    }
    
    /**
     * Get performance statistics
     */
    async getPerformanceStats() {
        if (!this.workletNode) {
            return null;
        }
        
        return new Promise((resolve) => {
            const handleStatsResponse = (event) => {
                if (event.data.type === 'performance-stats') {
                    this.workletNode.port.removeEventListener('message', handleStatsResponse);
                    resolve(event.data.stats);
                }
            };
            
            this.workletNode.port.addEventListener('message', handleStatsResponse);
            
            this.workletNode.port.postMessage({
                type: 'get-performance-stats'
            });
        });
    }
    
    // Event handling
    
    addEventListener(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, new Set());
        }
        this.eventListeners.get(event).add(callback);
    }
    
    removeEventListener(event, callback) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).delete(callback);
        }
    }
    
    emit(event, data) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event listener for ${event}:`, error);
                }
            });
        }
    }
    
    // Private methods
    
    handleWorkletMessage(event) {
        const { type, data } = event.data;
        
        switch (type) {
            case 'worklet-ready':
                this.emit('ready', data);
                break;
                
            case 'performance-warning':
                this.emit('performance-warning', data);
                console.warn('🚨 Audio performance warning:', data);
                break;
                
            case 'processing-error':
                this.emit('error', data);
                console.error('❌ Audio processing error:', data);
                break;
                
            default:
                this.emit('message', { type, data });
        }
    }
    
    async setupParameterAutomation() {
        // Setup parameter automation based on worklet parameter descriptors
        const parameters = await this.getParameters();
        
        parameters.forEach(param => {
            if (this.workletNode.parameters.has(param.name)) {
                this.parameters.set(param.name, param.defaultValue);
            }
        });
    }
    
    updateParameterMap(parameters) {
        this.parameters.clear();
        parameters.forEach(param => {
            this.parameters.set(param.name, param.defaultValue);
        });
    }
    
    startPerformanceMonitoring() {
        this.performanceInterval = setInterval(async () => {
            try {
                const stats = await this.getPerformanceStats();
                this.emit('performance-update', stats);
                
                // Log performance warnings
                if (stats.avgCPULoad > 80) {
                    console.warn(`🚨 High CPU load: ${stats.avgCPULoad.toFixed(1)}%`);
                }
                
                if (stats.overruns > this.lastPerformanceUpdate) {
                    console.warn(`🚨 Audio overruns detected: ${stats.overruns}`);
                    this.lastPerformanceUpdate = stats.overruns;
                }
                
            } catch (error) {
                console.error('Performance monitoring error:', error);
            }
        }, 5000); // Update every 5 seconds
    }
    
    stopPerformanceMonitoring() {
        if (this.performanceInterval) {
            clearInterval(this.performanceInterval);
            this.performanceInterval = null;
        }
    }
    
    getWorkletProcessorCode() {
        // Return the processor code as a string for dynamic loading
        // In a real implementation, this would be loaded from a separate file
        return `
            // The FaustAudioWorkletProcessor class code would go here
            // This is a placeholder for the actual implementation
            registerProcessor('faust-processor', FaustAudioWorkletProcessor);
        `;
    }
    
    /**
     * Cleanup resources
     */
    destroy() {
        this.stopPerformanceMonitoring();
        this.disconnect();
        
        if (this.workletNode) {
            this.workletNode = null;
        }
        
        this.parameters.clear();
        this.eventListeners.clear();
        
        console.log('🧹 Faust Audio Worklet Manager cleaned up');
    }
}

// Register the processor globally
if (typeof registerProcessor === 'function') {
    registerProcessor('faust-processor', FaustAudioWorkletProcessor);
}

// Export classes
export { FaustAudioWorkletProcessor, FaustAudioWorkletManager };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FaustAudioWorkletProcessor, FaustAudioWorkletManager };
}