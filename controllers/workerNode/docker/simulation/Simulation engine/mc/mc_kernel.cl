#include <stdio.h>
#include <stdlib.h>

int main(int argc, char *argv[]) {

    int runs = atoi(argv[1]);
    float volatility = atof(argv[2]);
    float rate = atof(argv[3]);

    printf("Runs: %d\n", runs);
    printf("Volatility: %f\n", volatility);
    printf("Rate: %f\n", rate);

    // Run OpenCL simulation

}

//Complie code: gcc montecarlo.c -lOpenCL -o montecarlo_opencl

// mc_kernel.cl

__kernel void monteCarloOption(
    const float S0,
    const float K,
    const float r,
    const float sigma,
    const float T,
    const int simulations,
    __global float *results
)
{
    int id = get_global_id(0);

    if (id >= simulations) return;

    uint seed = id * 1103515245 + 12345;

    float rand = (float)(seed % 10000) / 10000.0f;

    float ST = S0 * exp((r - 0.5f * sigma * sigma) * T +
                       sigma * sqrt(T) * rand);

    float payoff = fmax(ST - K, 0.0f);

    results[id] = exp(-r * T) * payoff;
}