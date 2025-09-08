/**
 * Faust.wasm WebGPU Integration
 * GPU-accelerated audio processing for advanced Faust DSP operations
 * Advanced WebGPU integration for Faust DSP
 * 
 * WASM Integration Copyright (c) 2025 Superstruct Ltd, New Zealand
 * Licensed under the same license as the underlying Faust project (LGPL 2.1)
 */

class FaustWebGPUProcessor {
    constructor(options = {}) {
        this.options = {
            powerPreference: 'high-performance',
            enableProfiling: false,
            maxBufferSize: 8192,
            preferredWorkgroupSize: 64,
            ...options
        };
        
        this.device = null;
        this.adapter = null;
        this.commandQueue = null;
        this.initialized = false;
        
        // Compute pipeline cache
        this.computePipelines = new Map();
        this.shaderModules = new Map();
        this.bufferPool = new Map();
        
        // Performance monitoring
        this.performanceStats = {
            totalComputePasses: 0,
            totalGPUTime: 0,
            averageGPUTime: 0,
            lastComputeTime: 0
        };
        
        // Supported compute operations
        this.supportedOperations = [
            'convolution_reverb',
            'oscillator_bank', 
            'spectral_processor',
            'multitap_delay',
            'parallel_filter_bank',
            'granular_synthesis',
            'audio_analysis',
            'dynamic_range_compressor'
        ];
    }
    
    /**
     * Initialize WebGPU for audio processing
     */
    async initialize() {
        if (this.initialized) {
            return true;
        }
        
        try {
            console.log('🚀 Initializing Faust WebGPU processor...');
            
            // Check WebGPU availability
            if (!navigator.gpu) {
                throw new Error('WebGPU not supported in this browser');
            }
            
            // Request adapter
            this.adapter = await navigator.gpu.requestAdapter({
                powerPreference: this.options.powerPreference
            });
            
            if (!this.adapter) {
                throw new Error('Failed to get WebGPU adapter');
            }
            
            console.log('✅ WebGPU adapter obtained');
            
            // Check required features
            const requiredFeatures = [];
            if (this.options.enableProfiling) {
                requiredFeatures.push('timestamp-query');
            }
            
            // Request device
            this.device = await this.adapter.requestDevice({
                requiredFeatures,
                requiredLimits: {
                    maxComputeWorkgroupStorageSize: 16384,
                    maxComputeInvocationsPerWorkgroup: 256,
                    maxComputeWorkgroupSizeX: 256,
                    maxStorageBufferBindingSize: 128 * 1024 * 1024 // 128MB
                }
            });
            
            this.commandQueue = this.device.queue;
            
            console.log('✅ WebGPU device and queue ready');
            
            // Load and compile compute shaders
            await this.loadComputeShaders();
            
            // Setup error handling
            this.device.addEventListener('uncapturederror', this.handleWebGPUError.bind(this));
            
            this.initialized = true;
            console.log('🎉 Faust WebGPU processor initialized successfully');
            
            return true;
            
        } catch (error) {
            console.error('❌ Failed to initialize WebGPU processor:', error);
            return false;
        }
    }
    
    /**
     * Load and compile compute shaders for audio processing
     */
    async loadComputeShaders() {
        console.log('📦 Loading Faust WebGPU compute shaders...');
        
        // Load the WGSL shader source
        const shaderSource = await this.loadShaderSource();
        
        try {
            // Create shader module
            const shaderModule = this.device.createShaderModule({
                label: 'Faust Audio Compute Shaders',
                code: shaderSource
            });
            
            this.shaderModules.set('faust_audio_compute', shaderModule);
            
            // Create compute pipelines for each operation
            for (const operation of this.supportedOperations) {
                await this.createComputePipeline(operation, shaderModule);
            }
            
            console.log(`✅ Loaded ${this.supportedOperations.length} compute pipelines`);
            
        } catch (error) {
            console.error('❌ Failed to compile compute shaders:', error);
            throw error;
        }
    }
    
    /**
     * Create compute pipeline for a specific operation
     */
    async createComputePipeline(operationName, shaderModule) {
        const pipeline = this.device.createComputePipeline({
            label: `Faust ${operationName} Pipeline`,
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: operationName
            }
        });
        
        this.computePipelines.set(operationName, pipeline);
        console.log(`   ✅ ${operationName} pipeline ready`);
    }
    
    /**
     * Process convolution reverb using GPU compute
     */
    async processConvolutionReverb(audioBuffer, impulseResponse, options = {}) {
        if (!this.initialized) {
            throw new Error('WebGPU processor not initialized');
        }
        
        const {
            wetMix = 0.3,
            workgroupSize = this.options.preferredWorkgroupSize
        } = options;
        
        const pipeline = this.computePipelines.get('convolution_reverb');
        if (!pipeline) {
            throw new Error('Convolution reverb pipeline not available');
        }
        
        try {
            const startTime = performance.now();
            
            // Create input buffers
            const inputBuffer = this.createBuffer(audioBuffer, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            const impulseBuffer = this.createBuffer(impulseResponse, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            
            // Create output buffer
            const outputSize = audioBuffer.length + impulseResponse.length - 1;
            const outputBuffer = this.device.createBuffer({
                size: outputSize * 4, // Float32
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
            });
            
            // Create parameter buffer
            const paramsData = new Uint32Array([
                audioBuffer.length,
                impulseResponse.length,
                outputSize,
                0 // Padding
            ]);
            paramsData[3] = new Float32Array([wetMix])[0]; // Reinterpret as float
            
            const paramsBuffer = this.createBuffer(paramsData, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
            
            // Create bind group
            const bindGroup = this.device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: inputBuffer } },
                    { binding: 1, resource: { buffer: impulseBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                    { binding: 3, resource: { buffer: paramsBuffer } }
                ]
            });
            
            // Encode and submit compute pass
            const commandEncoder = this.device.createCommandEncoder();
            const computePass = commandEncoder.beginComputePass();
            
            computePass.setPipeline(pipeline);
            computePass.setBindGroup(0, bindGroup);
            computePass.dispatchWorkgroups(Math.ceil(outputSize / workgroupSize));
            computePass.end();
            
            this.commandQueue.submit([commandEncoder.finish()]);
            
            // Read back results
            const result = await this.readBuffer(outputBuffer, outputSize);
            
            // Cleanup
            inputBuffer.destroy();
            impulseBuffer.destroy();
            outputBuffer.destroy();
            paramsBuffer.destroy();
            
            const computeTime = performance.now() - startTime;
            this.updatePerformanceStats(computeTime);
            
            console.log(`🎵 Convolution reverb processed: ${audioBuffer.length} + ${impulseResponse.length} samples in ${computeTime.toFixed(2)}ms`);
            
            return result;
            
        } catch (error) {
            console.error('❌ Convolution reverb processing failed:', error);
            throw error;
        }
    }
    
    /**
     * Generate oscillator bank using GPU parallel processing
     */
    async processOscillatorBank(frequencies, amplitudes, phases, sampleCount, sampleRate, timeOffset = 0) {
        const pipeline = this.computePipelines.get('oscillator_bank');
        if (!pipeline) {
            throw new Error('Oscillator bank pipeline not available');
        }
        
        try {
            const startTime = performance.now();
            
            // Create input buffers
            const freqBuffer = this.createBuffer(new Float32Array(frequencies), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            const ampBuffer = this.createBuffer(new Float32Array(amplitudes), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            const phaseBuffer = this.createBuffer(new Float32Array(phases), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            
            // Create output buffer
            const outputBuffer = this.device.createBuffer({
                size: sampleCount * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
            });
            
            // Create parameter buffer
            const paramsData = new Float32Array(4);
            paramsData[0] = sampleCount;
            paramsData[1] = frequencies.length;
            paramsData[2] = sampleRate;
            paramsData[3] = timeOffset;
            
            const paramsBuffer = this.createBuffer(paramsData, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
            
            // Create bind group
            const bindGroup = this.device.createBindGroup({
                layout: pipeline.getBindGroupLayout(1),
                entries: [
                    { binding: 0, resource: { buffer: outputBuffer } },
                    { binding: 1, resource: { buffer: freqBuffer } },
                    { binding: 2, resource: { buffer: ampBuffer } },
                    { binding: 3, resource: { buffer: phaseBuffer } },
                    { binding: 4, resource: { buffer: paramsBuffer } }
                ]
            });
            
            // Execute compute pass
            const commandEncoder = this.device.createCommandEncoder();
            const computePass = commandEncoder.beginComputePass();
            
            computePass.setPipeline(pipeline);
            computePass.setBindGroup(0, bindGroup);
            computePass.dispatchWorkgroups(Math.ceil(sampleCount / 64));
            computePass.end();
            
            this.commandQueue.submit([commandEncoder.finish()]);
            
            // Read results
            const result = await this.readBuffer(outputBuffer, sampleCount);
            
            // Cleanup
            [freqBuffer, ampBuffer, phaseBuffer, outputBuffer, paramsBuffer].forEach(buffer => buffer.destroy());
            
            const computeTime = performance.now() - startTime;
            this.updatePerformanceStats(computeTime);
            
            console.log(`🎹 Oscillator bank processed: ${frequencies.length} oscillators, ${sampleCount} samples in ${computeTime.toFixed(2)}ms`);
            
            return result;
            
        } catch (error) {
            console.error('❌ Oscillator bank processing failed:', error);
            throw error;
        }
    }
    
    /**
     * Process multi-tap delay network
     */
    async processMultitapDelay(inputAudio, tapDelays, tapGains, bufferSize, feedback = 0.3, outputGain = 1.0) {
        const pipeline = this.computePipelines.get('multitap_delay');
        if (!pipeline) {
            throw new Error('Multi-tap delay pipeline not available');
        }
        
        try {
            const startTime = performance.now();
            
            // Create buffers
            const inputBuffer = this.createBuffer(inputAudio, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            const delayBuffer = this.device.createBuffer({
                size: bufferSize * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            });
            const outputBuffer = this.device.createBuffer({
                size: inputAudio.length * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
            });
            const tapDelaysBuffer = this.createBuffer(new Uint32Array(tapDelays), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            const tapGainsBuffer = this.createBuffer(new Float32Array(tapGains), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            
            // Parameters
            const paramsData = new Float32Array(6);
            paramsData[0] = bufferSize;
            paramsData[1] = inputAudio.length;
            paramsData[2] = tapDelays.length;
            paramsData[3] = 0; // write_offset
            paramsData[4] = feedback;
            paramsData[5] = outputGain;
            
            const paramsBuffer = this.createBuffer(paramsData, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
            
            // Bind group
            const bindGroup = this.device.createBindGroup({
                layout: pipeline.getBindGroupLayout(3),
                entries: [
                    { binding: 0, resource: { buffer: inputBuffer } },
                    { binding: 1, resource: { buffer: delayBuffer } },
                    { binding: 2, resource: { buffer: outputBuffer } },
                    { binding: 3, resource: { buffer: tapDelaysBuffer } },
                    { binding: 4, resource: { buffer: tapGainsBuffer } },
                    { binding: 5, resource: { buffer: paramsBuffer } }
                ]
            });
            
            // Execute
            const commandEncoder = this.device.createCommandEncoder();
            const computePass = commandEncoder.beginComputePass();
            
            computePass.setPipeline(pipeline);
            computePass.setBindGroup(0, bindGroup);
            computePass.dispatchWorkgroups(Math.ceil(inputAudio.length / 64));
            computePass.end();
            
            this.commandQueue.submit([commandEncoder.finish()]);
            
            // Read results
            const result = await this.readBuffer(outputBuffer, inputAudio.length);
            
            // Cleanup
            [inputBuffer, delayBuffer, outputBuffer, tapDelaysBuffer, tapGainsBuffer, paramsBuffer]
                .forEach(buffer => buffer.destroy());
            
            const computeTime = performance.now() - startTime;
            this.updatePerformanceStats(computeTime);
            
            console.log(`🔄 Multi-tap delay processed: ${tapDelays.length} taps, ${inputAudio.length} samples in ${computeTime.toFixed(2)}ms`);
            
            return result;
            
        } catch (error) {
            console.error('❌ Multi-tap delay processing failed:', error);
            throw error;
        }
    }
    
    /**
     * Parallel filter bank processing
     */
    async processParallelFilterBank(inputAudio, filterCoefficients) {
        const pipeline = this.computePipelines.get('parallel_filter_bank');
        if (!pipeline) {
            throw new Error('Parallel filter bank pipeline not available');
        }
        
        const filterCount = filterCoefficients.length / 5; // 5 coefficients per filter
        
        try {
            const startTime = performance.now();
            
            // Create buffers
            const inputBuffer = this.createBuffer(inputAudio, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            const outputBuffer = this.device.createBuffer({
                size: inputAudio.length * filterCount * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
            });
            const coeffBuffer = this.createBuffer(new Float32Array(filterCoefficients), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            const statesBuffer = this.device.createBuffer({
                size: filterCount * 4 * 4, // 4 states per filter, 4 bytes per float
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            });
            
            // Parameters
            const paramsData = new Uint32Array([
                inputAudio.length,
                filterCount,
                5, // coefficients per filter
                4  // states per filter
            ]);
            
            const paramsBuffer = this.createBuffer(paramsData, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
            
            // Bind group
            const bindGroup = this.device.createBindGroup({
                layout: pipeline.getBindGroupLayout(4),
                entries: [
                    { binding: 0, resource: { buffer: inputBuffer } },
                    { binding: 1, resource: { buffer: outputBuffer } },
                    { binding: 2, resource: { buffer: coeffBuffer } },
                    { binding: 3, resource: { buffer: statesBuffer } },
                    { binding: 4, resource: { buffer: paramsBuffer } }
                ]
            });
            
            // Execute
            const commandEncoder = this.device.createCommandEncoder();
            const computePass = commandEncoder.beginComputePass();
            
            computePass.setPipeline(pipeline);
            computePass.setBindGroup(0, bindGroup);
            computePass.dispatchWorkgroups(Math.ceil(filterCount / 32));
            computePass.end();
            
            this.commandQueue.submit([commandEncoder.finish()]);
            
            // Read results (interleaved)
            const result = await this.readBuffer(outputBuffer, inputAudio.length * filterCount);
            
            // Cleanup
            [inputBuffer, outputBuffer, coeffBuffer, statesBuffer, paramsBuffer]
                .forEach(buffer => buffer.destroy());
            
            const computeTime = performance.now() - startTime;
            this.updatePerformanceStats(computeTime);
            
            console.log(`🎚️ Filter bank processed: ${filterCount} filters, ${inputAudio.length} samples in ${computeTime.toFixed(2)}ms`);
            
            return result;
            
        } catch (error) {
            console.error('❌ Parallel filter bank processing failed:', error);
            throw error;
        }
    }
    
    /**
     * Audio analysis (RMS, peak, spectral features)
     */
    async processAudioAnalysis(inputAudio, analysisType = 'rms', blockSize = 1024, hopSize = 512) {
        const pipeline = this.computePipelines.get('audio_analysis');
        if (!pipeline) {
            throw new Error('Audio analysis pipeline not available');
        }
        
        const analysisTypeMap = { 'rms': 0, 'peak': 1, 'spectral_centroid': 2 };
        const analysisTypeValue = analysisTypeMap[analysisType] || 0;
        
        try {
            const startTime = performance.now();
            
            const numBlocks = Math.ceil(inputAudio.length / hopSize);
            
            // Create buffers
            const inputBuffer = this.createBuffer(inputAudio, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            const outputBuffer = this.device.createBuffer({
                size: numBlocks * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
            });
            
            // Frequency bins for spectral analysis
            const frequencyBins = new Float32Array(blockSize / 2);
            for (let i = 0; i < frequencyBins.length; i++) {
                frequencyBins[i] = (i / blockSize) * 44100; // Assuming 44.1kHz sample rate
            }
            const freqBinsBuffer = this.createBuffer(frequencyBins, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            
            // Parameters
            const paramsData = new Uint32Array([
                inputAudio.length,
                analysisTypeValue,
                blockSize,
                hopSize
            ]);
            
            const paramsBuffer = this.createBuffer(paramsData, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
            
            // Bind group
            const bindGroup = this.device.createBindGroup({
                layout: pipeline.getBindGroupLayout(6),
                entries: [
                    { binding: 0, resource: { buffer: inputBuffer } },
                    { binding: 1, resource: { buffer: outputBuffer } },
                    { binding: 2, resource: { buffer: freqBinsBuffer } },
                    { binding: 3, resource: { buffer: paramsBuffer } }
                ]
            });
            
            // Execute
            const commandEncoder = this.device.createCommandEncoder();
            const computePass = commandEncoder.beginComputePass();
            
            computePass.setPipeline(pipeline);
            computePass.setBindGroup(0, bindGroup);
            computePass.dispatchWorkgroups(Math.ceil(numBlocks / 64));
            computePass.end();
            
            this.commandQueue.submit([commandEncoder.finish()]);
            
            // Read results
            const result = await this.readBuffer(outputBuffer, numBlocks);
            
            // Cleanup
            [inputBuffer, outputBuffer, freqBinsBuffer, paramsBuffer]
                .forEach(buffer => buffer.destroy());
            
            const computeTime = performance.now() - startTime;
            this.updatePerformanceStats(computeTime);
            
            console.log(`📊 Audio analysis (${analysisType}) processed: ${numBlocks} blocks in ${computeTime.toFixed(2)}ms`);
            
            return result;
            
        } catch (error) {
            console.error('❌ Audio analysis processing failed:', error);
            throw error;
        }
    }
    
    // Utility methods
    
    createBuffer(data, usage) {
        let buffer;
        let arrayBuffer;
        
        if (data instanceof Float32Array) {
            arrayBuffer = data.buffer;
        } else if (data instanceof Uint32Array) {
            arrayBuffer = data.buffer;
        } else if (Array.isArray(data)) {
            arrayBuffer = new Float32Array(data).buffer;
        } else {
            throw new Error('Unsupported data type for buffer creation');
        }
        
        buffer = this.device.createBuffer({
            size: arrayBuffer.byteLength,
            usage,
            mappedAtCreation: true
        });
        
        new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(arrayBuffer));
        buffer.unmap();
        
        return buffer;
    }
    
    async readBuffer(buffer, elementCount) {
        const readBuffer = this.device.createBuffer({
            size: elementCount * 4,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        
        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(buffer, 0, readBuffer, 0, elementCount * 4);
        this.commandQueue.submit([commandEncoder.finish()]);
        
        await readBuffer.mapAsync(GPUMapMode.READ);
        const arrayBuffer = readBuffer.getMappedRange();
        const result = new Float32Array(arrayBuffer.slice());
        
        readBuffer.unmap();
        readBuffer.destroy();
        
        return result;
    }
    
    async loadShaderSource() {
        // In a real implementation, this would load from a file or be embedded
        // For now, return a placeholder that would contain the WGSL code
        return `
            // Faust WebGPU compute shaders would be loaded here
            // This is a placeholder for the actual WGSL shader code
            // which would contain all the compute shaders defined in the .wgsl file
        `;
    }
    
    updatePerformanceStats(computeTime) {
        this.performanceStats.totalComputePasses++;
        this.performanceStats.totalGPUTime += computeTime;
        this.performanceStats.averageGPUTime = 
            this.performanceStats.totalGPUTime / this.performanceStats.totalComputePasses;
        this.performanceStats.lastComputeTime = computeTime;
    }
    
    handleWebGPUError(event) {
        console.error('🚨 WebGPU Error:', event.error);
    }
    
    /**
     * Get performance statistics
     */
    getPerformanceStats() {
        return { ...this.performanceStats };
    }
    
    /**
     * Get device capabilities
     */
    getDeviceInfo() {
        if (!this.adapter || !this.device) {
            return null;
        }
        
        return {
            adapter: {
                vendor: this.adapter.info?.vendor || 'unknown',
                architecture: this.adapter.info?.architecture || 'unknown',
                device: this.adapter.info?.device || 'unknown'
            },
            limits: this.device.limits,
            features: Array.from(this.device.features),
            supportedOperations: this.supportedOperations
        };
    }
    
    /**
     * Cleanup resources
     */
    destroy() {
        console.log('🧹 Cleaning up Faust WebGPU processor...');
        
        // Destroy pipelines
        this.computePipelines.clear();
        this.shaderModules.clear();
        
        // Clear buffer pool
        this.bufferPool.forEach(buffer => {
            if (buffer.destroy) {
                buffer.destroy();
            }
        });
        this.bufferPool.clear();
        
        // Destroy device
        if (this.device) {
            this.device.destroy();
            this.device = null;
        }
        
        this.initialized = false;
        console.log('✅ Faust WebGPU processor cleaned up');
    }
}

// Export for different module systems
export default FaustWebGPUProcessor;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FaustWebGPUProcessor;
}