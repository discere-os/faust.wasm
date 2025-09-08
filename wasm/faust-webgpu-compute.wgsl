// Faust.wasm WebGPU Compute Shaders
// Advanced audio processing using GPU compute for parallel DSP operations
// Advanced WebGPU compute shaders for Faust DSP
// 
// WASM Integration Copyright (c) 2025 Superstruct Ltd, New Zealand
// Licensed under the same license as the underlying Faust project (LGPL 2.1)

/**
 * WebGPU Compute Shader for Convolution Reverb
 * Processes impulse response convolution on GPU for real-time reverb
 * Workgroup size optimized for audio processing (64 threads)
 */
@group(0) @binding(0) var<storage, read> input_audio: array<f32>;
@group(0) @binding(1) var<storage, read> impulse_response: array<f32>;
@group(0) @binding(2) var<storage, read_write> output_audio: array<f32>;
@group(0) @binding(3) var<uniform> params: ConvolutionParams;

struct ConvolutionParams {
    input_length: u32,
    impulse_length: u32,
    output_length: u32,
    wet_mix: f32,
}

@compute @workgroup_size(64)
fn convolution_reverb(@builtin(global_invocation_id) id: vec3u) {
    let output_idx = id.x;
    
    // Bounds check
    if (output_idx >= params.output_length) {
        return;
    }
    
    var convolution_sum: f32 = 0.0;
    let max_tap = min(params.impulse_length, output_idx + 1);
    
    // Perform convolution sum
    for (var tap: u32 = 0u; tap < max_tap; tap++) {
        let input_idx = output_idx - tap;
        if (input_idx < params.input_length) {
            convolution_sum += input_audio[input_idx] * impulse_response[tap];
        }
    }
    
    // Apply wet/dry mix
    let dry_sample = select(0.0, input_audio[output_idx], output_idx < params.input_length);
    output_audio[output_idx] = dry_sample * (1.0 - params.wet_mix) + convolution_sum * params.wet_mix;
}

/**
 * WebGPU Compute Shader for Parallel Oscillator Bank
 * Generate multiple oscillators simultaneously for additive synthesis
 */
@group(1) @binding(0) var<storage, read_write> oscillator_output: array<f32>;
@group(1) @binding(1) var<storage, read> frequencies: array<f32>;
@group(1) @binding(2) var<storage, read> amplitudes: array<f32>;
@group(1) @binding(3) var<storage, read> phases: array<f32>;
@group(1) @binding(4) var<uniform> osc_params: OscillatorParams;

struct OscillatorParams {
    sample_count: u32,
    oscillator_count: u32,
    sample_rate: f32,
    time_offset: f32,
}

@compute @workgroup_size(64)
fn oscillator_bank(@builtin(global_invocation_id) id: vec3u) {
    let sample_idx = id.x;
    
    if (sample_idx >= osc_params.sample_count) {
        return;
    }
    
    let time = (f32(sample_idx) + osc_params.time_offset) / osc_params.sample_rate;
    var mixed_output: f32 = 0.0;
    
    // Sum all oscillators for this sample
    for (var osc_idx: u32 = 0u; osc_idx < osc_params.oscillator_count; osc_idx++) {
        let frequency = frequencies[osc_idx];
        let amplitude = amplitudes[osc_idx];
        let phase_offset = phases[osc_idx];
        
        // Generate sine wave
        let phase = 2.0 * 3.14159265359 * frequency * time + phase_offset;
        let sine_value = sin(phase);
        
        mixed_output += sine_value * amplitude;
    }
    
    oscillator_output[sample_idx] = mixed_output;
}

/**
 * WebGPU Compute Shader for Spectral Processing
 * Apply frequency-domain effects using overlapping FFT blocks
 */
@group(2) @binding(0) var<storage, read> time_domain_input: array<f32>;
@group(2) @binding(1) var<storage, read_write> frequency_domain: array<vec2<f32>>; // Complex numbers
@group(2) @binding(2) var<storage, read_write> time_domain_output: array<f32>;
@group(2) @binding(3) var<storage, read> spectral_filter: array<f32>;
@group(2) @binding(4) var<uniform> spectral_params: SpectralParams;

struct SpectralParams {
    fft_size: u32,
    overlap_factor: u32,
    filter_enabled: u32,
    spectral_gain: f32,
}

// Note: This is a simplified spectral processor
// A full implementation would require proper FFT/IFFT
@compute @workgroup_size(32)
fn spectral_processor(@builtin(global_invocation_id) id: vec3u) {
    let bin_idx = id.x;
    
    if (bin_idx >= spectral_params.fft_size / 2u) {
        return;
    }
    
    // Read complex frequency domain sample
    var complex_sample = frequency_domain[bin_idx];
    
    // Apply spectral filtering if enabled
    if (spectral_params.filter_enabled != 0u) {
        let filter_gain = spectral_filter[bin_idx];
        complex_sample.x *= filter_gain;
        complex_sample.y *= filter_gain;
    }
    
    // Apply overall spectral gain
    complex_sample.x *= spectral_params.spectral_gain;
    complex_sample.y *= spectral_params.spectral_gain;
    
    // Write back modified spectrum
    frequency_domain[bin_idx] = complex_sample;
}

/**
 * WebGPU Compute Shader for Multi-tap Delay Network
 * Implement complex delay networks for reverb algorithms
 */
@group(3) @binding(0) var<storage, read> delay_input: array<f32>;
@group(3) @binding(1) var<storage, read_write> delay_buffer: array<f32>;
@group(3) @binding(2) var<storage, read_write> delay_output: array<f32>;
@group(3) @binding(3) var<storage, read> tap_delays: array<u32>;
@group(3) @binding(4) var<storage, read> tap_gains: array<f32>;
@group(3) @binding(5) var<uniform> delay_params: DelayParams;

struct DelayParams {
    buffer_size: u32,
    sample_count: u32,
    tap_count: u32,
    write_offset: u32,
    feedback_gain: f32,
    output_gain: f32,
}

@compute @workgroup_size(64)
fn multitap_delay(@builtin(global_invocation_id) id: vec3u) {
    let sample_idx = id.x;
    
    if (sample_idx >= delay_params.sample_count) {
        return;
    }
    
    let write_pos = (delay_params.write_offset + sample_idx) % delay_params.buffer_size;
    let input_sample = delay_input[sample_idx];
    
    var output_sample: f32 = 0.0;
    var feedback_sum: f32 = 0.0;
    
    // Read from all delay taps
    for (var tap_idx: u32 = 0u; tap_idx < delay_params.tap_count; tap_idx++) {
        let delay_samples = tap_delays[tap_idx];
        let tap_gain = tap_gains[tap_idx];
        
        // Calculate read position with wraparound
        let read_pos = (write_pos + delay_params.buffer_size - delay_samples) % delay_params.buffer_size;
        let delayed_sample = delay_buffer[read_pos];
        
        output_sample += delayed_sample * tap_gain;
        feedback_sum += delayed_sample;
    }
    
    // Write input plus feedback to delay buffer
    delay_buffer[write_pos] = input_sample + feedback_sum * delay_params.feedback_gain;
    
    // Output with gain control
    delay_output[sample_idx] = output_sample * delay_params.output_gain;
}

/**
 * WebGPU Compute Shader for Parallel Filter Bank
 * Apply multiple filters simultaneously for frequency splitting
 */
@group(4) @binding(0) var<storage, read> filter_input: array<f32>;
@group(4) @binding(1) var<storage, read_write> filter_outputs: array<f32>; // Interleaved outputs
@group(4) @binding(2) var<storage, read> filter_coefficients: array<f32>; // b0,b1,b2,a1,a2 per filter
@group(4) @binding(3) var<storage, read_write> filter_states: array<f32>; // x1,x2,y1,y2 per filter
@group(4) @binding(4) var<uniform> filter_params: FilterParams;

struct FilterParams {
    sample_count: u32,
    filter_count: u32,
    coefficients_per_filter: u32, // Should be 5 (b0,b1,b2,a1,a2)
    states_per_filter: u32,       // Should be 4 (x1,x2,y1,y2)
}

@compute @workgroup_size(32)
fn parallel_filter_bank(@builtin(global_invocation_id) id: vec3u) {
    let filter_idx = id.x;
    
    if (filter_idx >= filter_params.filter_count) {
        return;
    }
    
    let coeff_offset = filter_idx * filter_params.coefficients_per_filter;
    let state_offset = filter_idx * filter_params.states_per_filter;
    
    // Load filter coefficients
    let b0 = filter_coefficients[coeff_offset];
    let b1 = filter_coefficients[coeff_offset + 1u];
    let b2 = filter_coefficients[coeff_offset + 2u];
    let a1 = filter_coefficients[coeff_offset + 3u];
    let a2 = filter_coefficients[coeff_offset + 4u];
    
    // Load filter states
    var x1 = filter_states[state_offset];
    var x2 = filter_states[state_offset + 1u];
    var y1 = filter_states[state_offset + 2u];
    var y2 = filter_states[state_offset + 3u];
    
    // Process all samples for this filter
    for (var sample_idx: u32 = 0u; sample_idx < filter_params.sample_count; sample_idx++) {
        let x = filter_input[sample_idx];
        
        // Biquad filter equation
        let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        
        // Update states
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        
        // Store output (interleaved: sample0_filter0, sample0_filter1, ...)
        filter_outputs[sample_idx * filter_params.filter_count + filter_idx] = y;
    }
    
    // Save updated filter states
    filter_states[state_offset] = x1;
    filter_states[state_offset + 1u] = x2;
    filter_states[state_offset + 2u] = y1;
    filter_states[state_offset + 3u] = y2;
}

/**
 * WebGPU Compute Shader for Granular Synthesis
 * Generate multiple audio grains simultaneously
 */
@group(5) @binding(0) var<storage, read> source_audio: array<f32>;
@group(5) @binding(1) var<storage, read_write> grain_output: array<f32>;
@group(5) @binding(2) var<storage, read> grain_positions: array<f32>;
@group(5) @binding(3) var<storage, read> grain_speeds: array<f32>;
@group(5) @binding(4) var<storage, read> grain_amplitudes: array<f32>;
@group(5) @binding(5) var<uniform> grain_params: GrainParams;

struct GrainParams {
    output_length: u32,
    source_length: u32,
    grain_count: u32,
    grain_size: u32,
    overlap_factor: f32,
    window_type: u32, // 0=Hann, 1=Blackman, etc.
}

@compute @workgroup_size(64)
fn granular_synthesis(@builtin(global_invocation_id) id: vec3u) {
    let output_idx = id.x;
    
    if (output_idx >= grain_params.output_length) {
        return;
    }
    
    var mixed_output: f32 = 0.0;
    let time_pos = f32(output_idx);
    
    // Process all active grains
    for (var grain_idx: u32 = 0u; grain_idx < grain_params.grain_count; grain_idx++) {
        let grain_pos = grain_positions[grain_idx];
        let grain_speed = grain_speeds[grain_idx];
        let grain_amp = grain_amplitudes[grain_idx];
        
        // Calculate position within this grain
        let grain_time = (time_pos - grain_pos) * grain_speed;
        
        // Check if we're within the grain boundaries
        if (grain_time >= 0.0 && grain_time < f32(grain_params.grain_size)) {
            // Calculate source position with bounds checking
            let source_pos = grain_time;
            let source_idx = u32(source_pos);
            let frac = source_pos - f32(source_idx);
            
            if (source_idx < grain_params.source_length - 1u) {
                // Interpolated sample from source
                let sample1 = source_audio[source_idx];
                let sample2 = source_audio[source_idx + 1u];
                let interpolated_sample = sample1 * (1.0 - frac) + sample2 * frac;
                
                // Apply grain window (Hann window)
                let window_pos = grain_time / f32(grain_params.grain_size);
                let window_value = 0.5 * (1.0 - cos(2.0 * 3.14159265359 * window_pos));
                
                mixed_output += interpolated_sample * window_value * grain_amp;
            }
        }
    }
    
    grain_output[output_idx] = mixed_output;
}

/**
 * WebGPU Compute Shader for Audio Analysis (RMS, Peak, Spectral Centroid)
 * Parallel computation of audio features for real-time analysis
 */
@group(6) @binding(0) var<storage, read> analysis_input: array<f32>;
@group(6) @binding(1) var<storage, read_write> analysis_results: array<f32>; // RMS, Peak, Centroid, etc.
@group(6) @binding(2) var<storage, read> frequency_bins: array<f32>; // For spectral analysis
@group(6) @binding(3) var<uniform> analysis_params: AnalysisParams;

struct AnalysisParams {
    sample_count: u32,
    analysis_type: u32, // 0=RMS, 1=Peak, 2=Spectral Centroid
    block_size: u32,
    hop_size: u32,
}

@compute @workgroup_size(64)
fn audio_analysis(@builtin(global_invocation_id) id: vec3u) {
    let thread_idx = id.x;
    let block_idx = thread_idx * analysis_params.hop_size;
    
    if (block_idx >= analysis_params.sample_count) {
        return;
    }
    
    let block_end = min(block_idx + analysis_params.block_size, analysis_params.sample_count);
    
    if (analysis_params.analysis_type == 0u) {
        // RMS calculation
        var sum_squares: f32 = 0.0;
        var sample_count_f: f32 = 0.0;
        
        for (var i: u32 = block_idx; i < block_end; i++) {
            let sample = analysis_input[i];
            sum_squares += sample * sample;
            sample_count_f += 1.0;
        }
        
        let rms = sqrt(sum_squares / sample_count_f);
        analysis_results[thread_idx] = rms;
        
    } else if (analysis_params.analysis_type == 1u) {
        // Peak detection
        var peak: f32 = 0.0;
        
        for (var i: u32 = block_idx; i < block_end; i++) {
            let abs_sample = abs(analysis_input[i]);
            peak = max(peak, abs_sample);
        }
        
        analysis_results[thread_idx] = peak;
        
    } else if (analysis_params.analysis_type == 2u) {
        // Spectral centroid (simplified - requires FFT for full implementation)
        var weighted_sum: f32 = 0.0;
        var magnitude_sum: f32 = 0.0;
        let bin_count = min(block_end - block_idx, arrayLength(&frequency_bins));
        
        for (var i: u32 = 0u; i < bin_count; i++) {
            let frequency = frequency_bins[i];
            let magnitude = abs(analysis_input[block_idx + i]); // Simplified
            
            weighted_sum += frequency * magnitude;
            magnitude_sum += magnitude;
        }
        
        let centroid = select(0.0, weighted_sum / magnitude_sum, magnitude_sum > 0.0);
        analysis_results[thread_idx] = centroid;
    }
}

/**
 * WebGPU Compute Shader for Dynamic Range Compression
 * Parallel compressor/limiter with look-ahead
 */
@group(7) @binding(0) var<storage, read> compressor_input: array<f32>;
@group(7) @binding(1) var<storage, read_write> compressor_output: array<f32>;
@group(7) @binding(2) var<storage, read_write> gain_reduction: array<f32>;
@group(7) @binding(3) var<uniform> compressor_params: CompressorParams;

struct CompressorParams {
    sample_count: u32,
    threshold: f32,
    ratio: f32,
    attack_time: f32,
    release_time: f32,
    makeup_gain: f32,
    lookahead_samples: u32,
}

@compute @workgroup_size(64)
fn dynamic_range_compressor(@builtin(global_invocation_id) id: vec3u) {
    let sample_idx = id.x;
    
    if (sample_idx >= compressor_params.sample_count) {
        return;
    }
    
    // Look-ahead for peak detection
    var peak_level: f32 = 0.0;
    let lookahead_end = min(sample_idx + compressor_params.lookahead_samples, compressor_params.sample_count);
    
    for (var i: u32 = sample_idx; i < lookahead_end; i++) {
        peak_level = max(peak_level, abs(compressor_input[i]));
    }
    
    // Convert to dB
    let peak_db = 20.0 * log(max(peak_level, 0.001)) / log(10.0);
    
    // Calculate gain reduction
    var gain_reduction_db: f32 = 0.0;
    
    if (peak_db > compressor_params.threshold) {
        let over_threshold = peak_db - compressor_params.threshold;
        gain_reduction_db = over_threshold * (1.0 - 1.0 / compressor_params.ratio);
    }
    
    // Convert back to linear gain
    let gain_reduction_linear = pow(10.0, -gain_reduction_db / 20.0);
    
    // Apply gain reduction and makeup gain
    let input_sample = compressor_input[sample_idx];
    let compressed_sample = input_sample * gain_reduction_linear * compressor_params.makeup_gain;
    
    compressor_output[sample_idx] = compressed_sample;
    gain_reduction[sample_idx] = gain_reduction_db;
}