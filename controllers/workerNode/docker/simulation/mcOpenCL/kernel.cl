__constant uint SOBOL_DIR_VECTORS[32] = {
    0x80000000,0x40000000,0x20000000,0x10000000,
    0x08000000,0x04000000,0x02000000,0x01000000,
    0x00800000,0x00400000,0x00200000,0x00100000,
    0x00080000,0x00040000,0x00020000,0x00010000,
    0x00008000,0x00004000,0x00002000,0x00001000,
    0x00000800,0x00000400,0x00000200,0x00000100,
    0x00000080,0x00000040,0x00000020,0x00000010,
    0x00000008,0x00000004,0x00000002,0x00000001
};

float sobol(uint i) {
    uint x = 0;
    for(int bit = 0; bit < 32; bit++) {
        if(i & (1 << bit))
            x ^= SOBOL_DIR_VECTORS[bit];
    }
    float u = (float)x / 4294967296.0f;
    if(u < 1e-7f) u = 1e-7f; // clamp to avoid log(0)
    return u;
}

float normal_from_uniform(float u) {
    if (u <= 1e-7f) u = 1e-7f;  // avoid log(0)
    return sqrt(-2.0f * log(u)) * cos(6.2831853f * u);
}

__kernel void monteCarloOption(
    const float S0,
    const float K,
    const float r,
    const float sigma,
    const float T,
    const int simulations,
    __global float *results ) {
        
    int id = get_global_id(0);

    if(id >= simulations)
        return;

    /* Sobol numbers */
    float u1 = sobol(id);
    float u2 = sobol(id + simulations);

    float z = normal_from_uniform(u1);
    float z2 = normal_from_uniform(u2);

    /* Brownian Bridge */

    float W_T = sqrt(T) * z;

    float mid_t = T * 0.5f;

    float mean = 0.5f * W_T;
    float variance = 0.25f * T;

    float W_mid = mean + sqrt(variance) * z2;

    /* Terminal price for Z */

    float ST1 = S0 * exp(
        (r - 0.5f * sigma * sigma) * T +
        sigma * W_T
    );

    float payoff1 = fmax(ST1 - K, 0.0f);

    /* Antithetic path (-Z) */

    float W_T_anti = -W_T;

    float ST2 = S0 * exp(
        (r - 0.5f * sigma * sigma) * T +
        sigma * W_T_anti
    );

    float payoff2 = fmax(ST2 - K, 0.0f);

    /* Average payoff */

    float payoff = 0.5f * (payoff1 + payoff2);

    results[id] = exp(-r * T) * payoff;
}