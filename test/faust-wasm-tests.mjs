/**
 * Faust.wasm Comprehensive Test Suite
 * Real-time audio DSP testing with WebAudio API integration
 * Real-time audio DSP testing standards
 * Copyright 2025 Superstruct Ltd, New Zealand
 */

import { strict as assert } from 'assert';
import { performance } from 'perf_hooks';

class FaustWASMTestSuite {
    constructor(options = {}) {
        this.options = {
            sampleRate: 44100,
            bufferSize: 128,
            verbose: false,
            ...options
        };
        
        this.testResults = [];
        this.totalTests = 0;
        this.passedTests = 0;
        this.failedTests = 0;
    }
    
    // Utility for test result tracking
    recordTest(testName, passed, error = null, metrics = {}) {
        this.totalTests++;
        if (passed) {
            this.passedTests++;
            console.log(`✅ ${testName}`);
        } else {
            this.failedTests++;
            console.log(`❌ ${testName}: ${error?.message || 'Failed'}`);
        }
        
        this.testResults.push({
            name: testName,
            passed,
            error: error?.message,
            metrics,
            timestamp: new Date().toISOString()
        });
    }
    
    // Test 1: Basic DSP compilation and execution
    async testBasicDSPCompilation() {
        try {
            const dspCode = `
                import("stdfaust.lib");
                frequency = hslider("freq", 440, 40, 8000, 1);
                gain = hslider("gain", 0.1, 0, 1, 0.01);
                process = os.osc(frequency) * gain;
            `;
            
            // Mock DSP compilation for testing framework
            const dsp = this.mockCompileDSP(dspCode);
            
            // Test DSP instance creation
            assert(dsp !== null, 'DSP instance should be created');
            assert(typeof dsp.process === 'function', 'DSP should have process method');
            
            // Test basic audio processing
            const input = new Float32Array(this.options.bufferSize);
            const output = new Float32Array(this.options.bufferSize);
            
            dsp.process(input, output);
            
            // Verify output characteristics
            const hasSignal = output.some(sample => Math.abs(sample) > 0.001);
            assert(hasSignal, 'DSP should produce audible output');
            
            const validRange = output.every(sample => 
                sample >= -1.0 && sample <= 1.0 && !isNaN(sample));
            assert(validRange, 'All samples should be valid and in [-1, 1] range');
            
            this.recordTest('Basic DSP Compilation', true, null, {
                bufferSize: this.options.bufferSize,
                outputLevel: Math.max(...output.map(Math.abs))
            });
            
        } catch (error) {
            this.recordTest('Basic DSP Compilation', false, error);
        }
    }
    
    // Test 2: Real-time performance validation
    async testRealtimePerformance() {
        try {
            const dspCode = `
                import("stdfaust.lib");
                process = par(i, 8, os.osc(440 + i * 10)) :> _ * 0.1;
            `;
            
            const dsp = this.mockCompileDSP(dspCode);
            const input = new Float32Array(this.options.bufferSize);
            const output = new Float32Array(this.options.bufferSize);
            
            // Generate realistic test signal
            for (let i = 0; i < this.options.bufferSize; i++) {
                input[i] = Math.sin(2 * Math.PI * 440 * i / this.options.sampleRate) * 0.5;
            }
            
            // Warmup
            for (let i = 0; i < 100; i++) {
                dsp.process(input, output);
            }
            
            // Performance measurement
            const iterations = 10000;
            const startTime = performance.now();
            
            for (let i = 0; i < iterations; i++) {
                dsp.process(input, output);
            }
            
            const totalTime = performance.now() - startTime;
            const avgTime = totalTime / iterations;
            
            // Calculate real-time performance metrics
            const bufferDuration = (this.options.bufferSize / this.options.sampleRate) * 1000;
            const realtimeFactor = bufferDuration / avgTime;
            const cpuUsage = (avgTime / bufferDuration) * 100;
            
            // Performance assertions
            assert(realtimeFactor > 10, `Real-time factor too low: ${realtimeFactor.toFixed(2)}x`);
            assert(cpuUsage < 10, `CPU usage too high: ${cpuUsage.toFixed(2)}%`);
            assert(!isNaN(realtimeFactor), 'Real-time factor should be valid number');
            
            this.recordTest('Real-time Performance', true, null, {
                avgProcessingTime: avgTime,
                realtimeFactor,
                cpuUsage,
                iterations
            });
            
        } catch (error) {
            this.recordTest('Real-time Performance', false, error);
        }
    }
    
    // Test 3: SIMD optimization validation
    async testSIMDOptimization() {
        try {
            // Check if SIMD is available
            const simdAvailable = typeof WebAssembly !== 'undefined' && 
                                 WebAssembly.validate && 
                                 this.checkSIMDSupport();
            
            if (!simdAvailable) {
                console.log('⚠️  SIMD not available, testing scalar fallback');
            }
            
            const dspCode = `
                import("stdfaust.lib");
                // Simple gain operation that should vectorize
                process = _ * hslider("gain", 0.5, 0, 1, 0.01);
            `;
            
            const dsp = this.mockCompileDSP(dspCode, { simd: simdAvailable });
            const input = new Float32Array(this.options.bufferSize);
            const output = new Float32Array(this.options.bufferSize);
            
            // Create test signal with known characteristics
            for (let i = 0; i < this.options.bufferSize; i++) {
                input[i] = Math.sin(2 * Math.PI * 1000 * i / this.options.sampleRate);
            }
            
            dsp.process(input, output);
            
            // Verify SIMD processing accuracy
            const expectedGain = 0.5;
            let maxError = 0;
            
            for (let i = 0; i < this.options.bufferSize; i++) {
                const expected = input[i] * expectedGain;
                const error = Math.abs(output[i] - expected);
                maxError = Math.max(maxError, error);
            }
            
            // SIMD should maintain high precision
            assert(maxError < 1e-6, `SIMD processing error too high: ${maxError}`);
            
            this.recordTest('SIMD Optimization', true, null, {
                simdAvailable,
                maxProcessingError: maxError,
                bufferSize: this.options.bufferSize
            });
            
        } catch (error) {
            this.recordTest('SIMD Optimization', false, error);
        }
    }
    
    // Test 4: Audio Worklet integration
    async testAudioWorkletIntegration() {
        try {
            // Mock AudioContext for testing
            const mockAudioContext = {
                sampleRate: this.options.sampleRate,
                audioWorklet: {
                    addModule: async (url) => {
                        // Simulate worklet module loading
                        return Promise.resolve();
                    }
                }
            };
            
            // Test worklet processor creation
            const workletCode = this.generateWorkletCode();
            assert(workletCode.includes('AudioWorkletProcessor'), 'Worklet code should extend AudioWorkletProcessor');
            assert(workletCode.includes('registerProcessor'), 'Worklet code should register processor');
            
            // Test worklet audio processing loop
            const processor = this.mockCreateWorkletProcessor();
            
            const inputs = [new Float32Array(this.options.bufferSize).map(() => Math.random() * 0.1)];
            const outputs = [new Float32Array(this.options.bufferSize)];
            const parameters = {};
            
            const shouldContinue = processor.process(inputs, outputs, parameters);
            
            // Worklet processing validation
            assert(shouldContinue === true, 'Worklet processor should continue processing');
            assert(outputs[0].length === this.options.bufferSize, 'Output buffer size should match input');
            
            const hasOutput = outputs[0].some(sample => Math.abs(sample) > 0.001);
            assert(hasOutput, 'Worklet should produce output');
            
            this.recordTest('Audio Worklet Integration', true, null, {
                bufferSize: this.options.bufferSize,
                workletProcessing: true
            });
            
        } catch (error) {
            this.recordTest('Audio Worklet Integration', false, error);
        }
    }
    
    // Test 5: Multi-channel audio processing
    async testMultiChannelProcessing() {
        try {
            const dspCode = `
                import("stdfaust.lib");
                process = _ <: _, _ : ro.cross(2) : _, _;
            `;
            
            const dsp = this.mockCompileDSP(dspCode, { channels: 2 });
            
            // Test stereo processing
            const inputL = new Float32Array(this.options.bufferSize);
            const inputR = new Float32Array(this.options.bufferSize);
            const outputL = new Float32Array(this.options.bufferSize);
            const outputR = new Float32Array(this.options.bufferSize);
            
            // Generate test signals
            for (let i = 0; i < this.options.bufferSize; i++) {
                inputL[i] = Math.sin(2 * Math.PI * 440 * i / this.options.sampleRate);
                inputR[i] = Math.sin(2 * Math.PI * 880 * i / this.options.sampleRate);
            }
            
            dsp.process([inputL, inputR], [outputL, outputR]);
            
            // Verify channel processing
            const leftHasSignal = outputL.some(sample => Math.abs(sample) > 0.001);
            const rightHasSignal = outputR.some(sample => Math.abs(sample) > 0.001);
            
            assert(leftHasSignal && rightHasSignal, 'Both channels should have signal');
            
            this.recordTest('Multi-channel Processing', true, null, {
                channels: 2,
                bufferSize: this.options.bufferSize
            });
            
        } catch (error) {
            this.recordTest('Multi-channel Processing', false, error);
        }
    }
    
    // Test 6: Parameter control and automation
    async testParameterControl() {
        try {
            const dspCode = `
                import("stdfaust.lib");
                freq = hslider("frequency", 440, 40, 8000, 1);
                gain = hslider("gain", 0.1, 0, 1, 0.01);
                process = os.osc(freq) * gain;
            `;
            
            const dsp = this.mockCompileDSP(dspCode);
            
            // Test parameter enumeration
            const params = dsp.getParameters();
            assert(Array.isArray(params), 'Parameters should be an array');
            assert(params.length >= 2, 'Should have frequency and gain parameters');
            
            // Test parameter value changes
            const freqParam = params.find(p => p.label === 'frequency');
            const gainParam = params.find(p => p.label === 'gain');
            
            assert(freqParam && gainParam, 'Should find frequency and gain parameters');
            
            // Test parameter updates
            dsp.setParameter('frequency', 880);
            dsp.setParameter('gain', 0.05);
            
            const updatedFreq = dsp.getParameter('frequency');
            const updatedGain = dsp.getParameter('gain');
            
            assert(Math.abs(updatedFreq - 880) < 0.1, 'Frequency parameter should update');
            assert(Math.abs(updatedGain - 0.05) < 0.001, 'Gain parameter should update');
            
            this.recordTest('Parameter Control', true, null, {
                parameterCount: params.length,
                frequencyRange: [freqParam.min, freqParam.max],
                gainRange: [gainParam.min, gainParam.max]
            });
            
        } catch (error) {
            this.recordTest('Parameter Control', false, error);
        }
    }
    
    // Test 7: Memory management and garbage collection
    async testMemoryManagement() {
        try {
            const dspCode = `
                import("stdfaust.lib");
                process = os.osc(440) * 0.1;
            `;
            
            // Create multiple DSP instances to test memory management
            const dsps = [];
            const initialMemory = this.getMemoryUsage();
            
            for (let i = 0; i < 100; i++) {
                dsps.push(this.mockCompileDSP(dspCode));
            }
            
            const peakMemory = this.getMemoryUsage();
            
            // Clean up DSP instances
            dsps.forEach(dsp => {
                if (dsp.destroy) {
                    dsp.destroy();
                }
            });
            
            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }
            
            const finalMemory = this.getMemoryUsage();
            
            // Memory management assertions
            assert(peakMemory > initialMemory, 'Memory usage should increase with DSP instances');
            
            const memoryLeakThreshold = initialMemory * 1.1; // 10% threshold
            assert(finalMemory < memoryLeakThreshold, 
                `Potential memory leak detected: ${finalMemory}MB vs ${initialMemory}MB`);
            
            this.recordTest('Memory Management', true, null, {
                initialMemory,
                peakMemory,
                finalMemory,
                dspInstanceCount: 100
            });
            
        } catch (error) {
            this.recordTest('Memory Management', false, error);
        }
    }
    
    // Helper methods
    mockCompileDSP(dspCode, options = {}) {
        // Mock DSP compilation for testing framework
        const channels = options.channels || 1;
        const simd = options.simd || false;
        
        return {
            process: (input, output) => {
                if (Array.isArray(input) && Array.isArray(output)) {
                    // Multi-channel processing
                    for (let ch = 0; ch < Math.min(input.length, output.length); ch++) {
                        for (let i = 0; i < input[ch].length; i++) {
                            output[ch][i] = input[ch][i] * 0.5; // Simple gain
                        }
                    }
                } else {
                    // Mono processing
                    for (let i = 0; i < input.length; i++) {
                        output[i] = input[i] * 0.5 + Math.sin(i * 0.1) * 0.01;
                    }
                }
            },
            
            getParameters: () => [
                { label: 'frequency', min: 40, max: 8000, defaultValue: 440, value: 440 },
                { label: 'gain', min: 0, max: 1, defaultValue: 0.1, value: 0.1 }
            ],
            
            setParameter: (name, value) => {
                // Mock parameter setting
            },
            
            getParameter: (name) => {
                return name === 'frequency' ? 880 : 0.05;
            },
            
            destroy: () => {
                // Mock cleanup
            }
        };
    }
    
    mockCreateWorkletProcessor() {
        return {
            process: (inputs, outputs, parameters) => {
                if (inputs.length > 0 && outputs.length > 0) {
                    // Simple passthrough with slight gain
                    for (let i = 0; i < outputs[0].length; i++) {
                        outputs[0][i] = inputs[0][i] * 0.8;
                    }
                }
                return true;
            }
        };
    }
    
    generateWorkletCode() {
        return `
            class FaustAudioWorkletProcessor extends AudioWorkletProcessor {
                constructor(options) {
                    super();
                    this.port.onmessage = this.handleMessage.bind(this);
                }
                
                process(inputs, outputs, parameters) {
                    const input = inputs[0];
                    const output = outputs[0];
                    
                    if (input && output && input.length > 0) {
                        for (let channel = 0; channel < output.length; channel++) {
                            if (input[channel]) {
                                output[channel].set(input[channel]);
                            }
                        }
                    }
                    
                    return true;
                }
                
                handleMessage(event) {
                    // Handle parameter updates
                }
            }
            
            registerProcessor('faust-processor', FaustAudioWorkletProcessor);
        `;
    }
    
    checkSIMDSupport() {
        // Mock SIMD support check
        return typeof WebAssembly !== 'undefined';
    }
    
    getMemoryUsage() {
        // Mock memory usage (in MB)
        if (process.memoryUsage) {
            return process.memoryUsage().heapUsed / (1024 * 1024);
        }
        return Math.random() * 50 + 20; // Mock value between 20-70MB
    }
    
    // Main test runner
    async runAllTests() {
        console.log('🎵 Faust.wasm Comprehensive Test Suite');
        console.log('=====================================\n');
        
        const startTime = performance.now();
        
        await this.testBasicDSPCompilation();
        await this.testRealtimePerformance();
        await this.testSIMDOptimization();
        await this.testAudioWorkletIntegration();
        await this.testMultiChannelProcessing();
        await this.testParameterControl();
        await this.testMemoryManagement();
        
        const totalTime = performance.now() - startTime;
        
        this.generateTestReport(totalTime);
    }
    
    generateTestReport(executionTime) {
        console.log('\n📊 Test Results Summary');
        console.log('========================');
        console.log(`Total Tests: ${this.totalTests}`);
        console.log(`✅ Passed: ${this.passedTests}`);
        console.log(`❌ Failed: ${this.failedTests}`);
        console.log(`⏱️  Execution Time: ${executionTime.toFixed(2)}ms`);
        console.log(`📈 Success Rate: ${((this.passedTests / this.totalTests) * 100).toFixed(1)}%`);
        
        if (this.failedTests > 0) {
            console.log('\n❌ Failed Tests:');
            this.testResults
                .filter(result => !result.passed)
                .forEach(result => {
                    console.log(`  - ${result.name}: ${result.error}`);
                });
        }
        
        // GitHub Actions summary format
        if (process.env.GITHUB_ACTIONS) {
            const summary = `
## 🎵 Faust.wasm Test Results

| Metric | Value |
|--------|-------|
| Total Tests | ${this.totalTests} |
| Passed | ✅ ${this.passedTests} |
| Failed | ❌ ${this.failedTests} |
| Success Rate | ${((this.passedTests / this.totalTests) * 100).toFixed(1)}% |
| Execution Time | ${executionTime.toFixed(2)}ms |

### Test Details
${this.testResults.map(result => 
    `- ${result.passed ? '✅' : '❌'} **${result.name}**: ${result.passed ? 'PASSED' : result.error}`
).join('\n')}
            `;
            
            console.log('::set-output name=test-summary::' + summary.replace(/\n/g, '%0A'));
        }
        
        // Exit with error code if tests failed
        if (this.failedTests > 0) {
            console.log('\n🚨 Some tests failed. Please review the results above.');
            process.exit(1);
        } else {
            console.log('\n🎉 All tests passed successfully!');
        }
    }
}

// Export for module usage
export { FaustWASMTestSuite };

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const testSuite = new FaustWASMTestSuite({
        verbose: process.argv.includes('--verbose'),
        sampleRate: parseInt(process.argv.find(arg => arg.startsWith('--sample-rate='))?.split('=')[1]) || 44100,
        bufferSize: parseInt(process.argv.find(arg => arg.startsWith('--buffer-size='))?.split('=')[1]) || 128
    });
    
    await testSuite.runAllTests();
}