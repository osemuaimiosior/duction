#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <omp.h>
#include <stdint.h>

#define PI 3.14159265358979323846

//Inputs: spot price, volatility, strike, maturity, number of paths

/* Fast XORSHIFT RNG */
static inline uint64_t xorshift64(uint64_t *state) {
    uint64_t x = *state;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *state = x;
    return x;
}

/* Convert RNG → uniform float */
static inline double rand_uniform(uint64_t *state) {
    return (xorshift64(state) >> 11) * (1.0 / 9007199254740992.0);
}

/* Box-Muller Gaussian */
static inline double rand_normal(uint64_t *state) {
    double u1 = rand_uniform(state);
    double u2 = rand_uniform(state);
    return sqrt(-2.0 * log(u1)) * cos(2.0 * PI * u2);
}

int main(int argc, char *argv[]) {

    if (argc < 7) {
        printf("Usage: runs S0 K r sigma T\n");
        return 1;
    }

    long long runs = atoll(argv[1]);

    double S0 = atof(argv[2]);
    double K = atof(argv[3]);
    double r = atof(argv[4]);
    double sigma = atof(argv[5]);
    double T = atof(argv[6]);

    double drift = (r - 0.5 * sigma * sigma) * T;
    double diffusion = sigma * sqrt(T);

    double payoff_sum = 0.0;

    double start = omp_get_wtime();

    #pragma omp parallel
    {
        uint64_t seed = 1234 + omp_get_thread_num() * 777;

        double local_sum = 0.0;

        #pragma omp for schedule(static)
        for (long long i = 0; i < runs; i++) {

            double Z = rand_normal(&seed);

            double ST = S0 * exp(drift + diffusion * Z);

            double payoff = fmax(ST - K, 0.0);

            local_sum += payoff;
        }

        #pragma omp atomic
        payoff_sum += local_sum;
    }

    double option_price = exp(-r * T) * payoff_sum / runs;

    double end = omp_get_wtime();

    double elapsed = end - start;

    printf("{\n");
    printf("  \"option_price\": %.6f,\n", option_price);
    printf("  \"runs\": %lld,\n", runs);
    printf("  \"time_sec\": %.4f,\n", elapsed);
    printf("  \"simulations_per_sec\": %.0f\n", runs / elapsed);
    printf("}\n");

    return 0;
}