import numpy as np
from scipy.fft import fft
from scipy.signal import find_peaks

# helpers
def slope(segment):
    return np.diff(segment)

def variance(segment):
    return np.var(segment)

def amplitude(segment):
    return np.max(segment) - np.min(segment)

def volume(segment):
    return np.sum(np.abs(segment))





# feature functions

def is_rising(segment):
    return all(slope(segment) > 0)

def is_falling(segment):
    return all(slope(segment) < 0)

def is_concave(segment):
    return np.all(np.diff(slope(segment)) < 0)

def is_convex(segment):
    return np.all(np.diff(slope(segment)) > 0)

def is_linear(segment, VALUE):
    return variance(slope(segment)) < VALUE

def is_non_linear(segment, VALUE):
    return variance(slope(segment)) > VALUE

def is_constant(segment, VALUE):   
    return variance(segment) < VALUE

def is_smooth(segment, VALUE):
    return variance(segment) < VALUE

def is_noisy(segment, VALUE):
    return variance(segment) > VALUE

def is_complex(segment, VALUE):
    return variance(segment) > VALUE and len(find_peaks(segment)[0]) > 2

def is_simple(segment, VALUE):
    return variance(segment) < VALUE and len(find_peaks(segment)[0]) == 0

def is_spiky(segment, VALUE):
    peaks, _ = find_peaks(segment)
    return len(peaks) > 0 and np.any(np.abs(np.diff(segment)) > VALUE)

def is_dropout(segment, VALUE):
    return any(x < VALUE for x in segment)

def is_periodic(segment, VALUE):
    freq = np.abs(fft(segment))
    return np.any(freq > VALUE)

def is_aperiodic(segment, VALUE):
    freq = np.abs(fft(segment))
    return np.all(freq < VALUE)

def is_symmetric(segment):
    n = len(segment)
    return np.allclose(segment[:n // 2], segment[-(n // 2):][::-1])

def is_asymmetric(segment):
    return not is_symmetric(segment)

def is_step(segment, VALUE):
    return any(np.abs(np.diff(segment)) > VALUE)

def is_no_step(segment, VALUE):
    return all(np.abs(np.diff(segment)) < VALUE)

def is_high_amplitude(segment, VALUE):
    return amplitude(segment) > VALUE

def is_low_amplitude(segment, VALUE):
    return amplitude(segment) < VALUE

def is_high_volume(segment, VALUE):
    return volume(segment) > VALUE

def is_low_volume(segment, VALUE):
    return volume(segment) < VALUE
