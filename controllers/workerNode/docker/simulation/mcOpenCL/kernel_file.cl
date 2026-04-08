__kernel void simpleKernel(__global float* results, const int n) {
    int id = get_global_id(0);
    if (id >= n) return;

    // Just write the index + 2 as result
    results[id] = (float)(id + 2);
}